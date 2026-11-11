"""Sign-in for the dashboard: a demo pass, or OAuth with the tools crews already use.

Providers turn on when their keys are in the environment. Each one uses the
authorization-code flow: we send the browser to the provider, get a code back,
exchange it server-to-server over TLS, then read the user's name and email
from the provider's userinfo endpoint. No password ever reaches Benchmark.

    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
    SLACK_CLIENT_ID / SLACK_CLIENT_SECRET          (Sign in with Slack, OpenID Connect)
    ALLOWED_EMAIL_DOMAINS=summitridge.example      (optional, comma separated)
    ALLOWED_EMAILS=pat@gmail.com,sam@gmail.com     (optional, exact addresses; for teams on personal accounts)
    PUBLIC_URL=https://dash.example.com            (optional, for the callback URL behind a proxy)
"""

from __future__ import annotations

import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any
from collections.abc import Callable

TIMEOUT_SECONDS = 8
Opener = Callable[[urllib.request.Request], Any]


def _default_opener(request: urllib.request.Request) -> Any:
    return urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS)  # noqa: S310 - fixed provider hosts


@dataclass(frozen=True)
class Provider:
    id: str
    label: str
    why: str
    authorize_url: str
    token_url: str
    userinfo_url: str
    scope: str
    env: str

    def keys(self, env: dict[str, str]) -> tuple[str, str]:
        return env.get(f"{self.env}_CLIENT_ID", "").strip(), env.get(f"{self.env}_CLIENT_SECRET", "").strip()

    def configured(self, env: dict[str, str]) -> bool:
        return all(self.keys(env))


def providers(env: dict[str, str] | None = None) -> list[Provider]:
    env = dict(os.environ if env is None else env)
    return [
        Provider(
            "google", "Google", "Google Workspace accounts",
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://oauth2.googleapis.com/token",
            "https://openidconnect.googleapis.com/v1/userinfo",
            "openid email profile", "GOOGLE",
        ),
        Provider(
            "slack", "Slack", "the workspace the crew already uses",
            "https://slack.com/openid/connect/authorize",
            "https://slack.com/api/openid.connect.token",
            "https://slack.com/api/openid.connect.userInfo",
            "openid email profile", "SLACK",
        ),
    ]


def provider_by_id(provider_id: str, env: dict[str, str] | None = None) -> Provider | None:
    return next((p for p in providers(env) if p.id == provider_id), None)


class AuthError(RuntimeError):
    pass


def new_state() -> str:
    return secrets.token_urlsafe(24)


def authorize_redirect(provider: Provider, redirect_uri: str, state: str, env: dict[str, str] | None = None) -> str:
    client_id, _ = provider.keys(dict(os.environ if env is None else env))
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "state": state}
    if provider.scope:
        params["scope"] = provider.scope
    if provider.id == "google":
        params["prompt"] = "select_account"
    return f"{provider.authorize_url}?{urllib.parse.urlencode(params)}"


def exchange_and_identify(
    provider: Provider,
    code: str,
    redirect_uri: str,
    env: dict[str, str] | None = None,
    opener: Opener = _default_opener,
) -> dict[str, str]:
    env = dict(os.environ if env is None else env)
    client_id, client_secret = provider.keys(env)
    token = _json(
        opener,
        urllib.request.Request(
            provider.token_url,
            data=urllib.parse.urlencode(
                {
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": client_id,
                    "client_secret": client_secret,
                }
            ).encode(),
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        ),
    )
    access = token.get("access_token")
    if not access:
        raise AuthError(f"{provider.label} did not return an access token ({token.get('error', 'no error given')}).")
    info = _json(
        opener,
        urllib.request.Request(provider.userinfo_url, headers={"Authorization": f"Bearer {access}", "Accept": "application/json"}),
    )
    if info.get("ok") is False:
        raise AuthError(f"{provider.label} refused the profile request ({info.get('error')}).")
    email = (info.get("email") or info.get("login") or info.get("preferred_username") or "").strip()
    name = (info.get("name") or info.get("given_name") or email or "Signed-in user").strip()
    if not email:
        raise AuthError(f"{provider.label} did not share an email address.")
    if info.get("email_verified") is False or info.get("email_verified") == "false":
        raise AuthError(f"{provider.label} has not verified that email address.")
    _check_allowed(email, env)
    return {"name": name[:80], "email": email[:120], "provider": provider.id, "providerLabel": provider.label}


def _split(value: str) -> set[str]:
    return {x.strip().lower().lstrip("@") for x in value.split(",") if x.strip()}


def _check_allowed(email: str, env: dict[str, str]) -> None:
    """With no list set, any account the provider vouches for may sign in. With either list, it must match one."""
    domains = _split(env.get("ALLOWED_EMAIL_DOMAINS", ""))
    emails = _split(env.get("ALLOWED_EMAILS", ""))
    if not domains and not emails:
        return
    address = email.lower()
    if address in emails or address.rsplit("@", 1)[-1] in domains:
        return
    raise AuthError("That account is not on this team's sign-in list. Ask the owner to add it.")


def _json(opener: Opener, request: urllib.request.Request) -> dict[str, Any]:
    try:
        with opener(request) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode())
        except Exception:  # noqa: BLE001 - provider error bodies vary
            body = {}
        raise AuthError(f"Sign-in request failed ({error.code} {body.get('error', '')}).".replace(" )", ")")) from error
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
        raise AuthError(f"Could not reach the sign-in provider: {error}") from error


DEMO_USER = {"name": "Demo viewer", "email": "", "provider": "demo", "providerLabel": "Demo"}
