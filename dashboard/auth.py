"""Sign-in for the dashboard: a demo pass, or OAuth with the tools crews already use.

Providers turn on when their keys are in the environment. Each one uses the
authorization-code flow: we send the browser to the provider, get a code back,
exchange it server-to-server over TLS, then read the user's name and email
from the provider's userinfo endpoint. No password ever reaches Benchmark.

    GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
    SLACK_CLIENT_ID / SLACK_CLIENT_SECRET          (Sign in with Slack, OpenID Connect)
    MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET  (Microsoft 365 / Entra ID; MICROSOFT_TENANT, default "organizations")
    PROCORE_CLIENT_ID / PROCORE_CLIENT_SECRET      (Procore OAuth)
    ALLOWED_EMAIL_DOMAINS=summitridge.example      (optional, comma separated)
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
    tenant = env.get("MICROSOFT_TENANT", "organizations").strip() or "organizations"
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
        Provider(
            "microsoft", "Microsoft 365", "Outlook and Teams accounts",
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
            f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            "https://graph.microsoft.com/oidc/userinfo",
            "openid email profile", "MICROSOFT",
        ),
        Provider(
            "procore", "Procore", "your project management login",
            "https://login.procore.com/oauth/authorize",
            "https://login.procore.com/oauth/token",
            "https://api.procore.com/rest/v1.0/me",
            "", "PROCORE",
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
    if provider.id in ("google", "microsoft"):
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
    _check_domain(email, env)
    return {"name": name[:80], "email": email[:120], "provider": provider.id, "providerLabel": provider.label}


def _check_domain(email: str, env: dict[str, str]) -> None:
    allowed = [d.strip().lower().lstrip("@") for d in env.get("ALLOWED_EMAIL_DOMAINS", "").split(",") if d.strip()]
    if allowed and email.rsplit("@", 1)[-1].lower() not in allowed:
        raise AuthError("That account is not on an allowed company domain.")


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
