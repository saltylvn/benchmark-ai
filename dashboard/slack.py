"""Slack connection for the dashboard.

Two ways to connect, picked from the environment:

* ``SLACK_BOT_TOKEN`` (xoxb-...) plus ``SLACK_CHANNEL`` (a channel id the bot is in).
  Status uses ``auth.test``; sending uses ``chat.postMessage``.
* ``SLACK_WEBHOOK_URL``, an incoming webhook bound to one channel.

Nothing is posted unless ``SLACK_SEND_ENABLED=1`` *and* a PM presses
"Approve & send" on the dashboard. Otherwise the send is a dry run that shows
the exact payload Slack would receive. The agents never call this module.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

API = "https://slack.com/api"
TIMEOUT_SECONDS = 8

Opener = Callable[[urllib.request.Request], Any]


def _default_opener(request: urllib.request.Request) -> Any:
    return urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS)  # noqa: S310 - fixed Slack hosts


@dataclass
class SlackConfig:
    bot_token: str = ""
    channel: str = ""
    webhook_url: str = ""
    send_enabled: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "SlackConfig":
        env = dict(os.environ if env is None else env)
        return cls(
            bot_token=env.get("SLACK_BOT_TOKEN", "").strip(),
            channel=env.get("SLACK_CHANNEL", "").strip(),
            webhook_url=env.get("SLACK_WEBHOOK_URL", "").strip(),
            send_enabled=env.get("SLACK_SEND_ENABLED", "").strip() == "1",
        )

    @property
    def mode(self) -> str:
        if self.bot_token:
            return "bot"
        if self.webhook_url:
            return "webhook"
        return "none"


@dataclass
class SlackConnector:
    config: SlackConfig
    opener: Opener = _default_opener
    audit: list[dict[str, Any]] = field(default_factory=list)

    # -- status ------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        cfg = self.config
        base = {
            "mode": cfg.mode,
            "sendEnabled": cfg.send_enabled,
            "channel": cfg.channel or None,
        }
        if cfg.mode == "none":
            return {**base, "connected": False, "detail": "Not connected. Set SLACK_BOT_TOKEN + SLACK_CHANNEL, or SLACK_WEBHOOK_URL."}
        if cfg.mode == "webhook":
            if not cfg.webhook_url.startswith("https://hooks.slack.com/"):
                return {**base, "connected": False, "detail": "SLACK_WEBHOOK_URL must start with https://hooks.slack.com/."}
            return {**base, "connected": True, "detail": "Incoming webhook configured. Slack offers no read-only check for webhooks."}
        try:
            data = self._api("auth.test", {})
        except SlackError as error:
            return {**base, "connected": False, "detail": str(error)}
        if not cfg.channel:
            return {**base, "connected": False, "team": data.get("team"), "detail": "Token works. Set SLACK_CHANNEL to the channel id the bot should post in."}
        return {
            **base,
            "connected": True,
            "team": data.get("team"),
            "botUser": data.get("user"),
            "detail": f"auth.test ok for workspace {data.get('team')} as {data.get('user')}.",
        }

    # -- send --------------------------------------------------------------

    def build_payload(self, text: str, context: str, approved_by: str) -> dict[str, Any]:
        return {
            "text": text,
            "blocks": [
                {"type": "section", "text": {"type": "mrkdwn", "text": text}},
                {
                    "type": "context",
                    "elements": [
                        {"type": "mrkdwn", "text": f"Benchmark · {context} · approved by {approved_by}"}
                    ],
                },
            ],
        }

    def send(self, text: str, *, context: str, approved_by: str) -> dict[str, Any]:
        payload = self.build_payload(text, context, approved_by)
        record: dict[str, Any] = {
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "context": context,
            "approvedBy": approved_by,
            "mode": self.config.mode,
            "payload": payload,
        }
        if self.config.mode == "none" or not self.config.send_enabled:
            reason = "Slack is not connected" if self.config.mode == "none" else "SLACK_SEND_ENABLED is not 1"
            record.update(result="dry-run", detail=f"Dry run: {reason}. This is the exact payload Slack would receive.")
            self.audit.append(record)
            return record
        try:
            if self.config.mode == "bot":
                if not self.config.channel:
                    raise SlackError("SLACK_CHANNEL is not set.")
                data = self._api("chat.postMessage", {"channel": self.config.channel, **payload})
                record.update(result="sent", detail=f"Posted to {data.get('channel')} at ts {data.get('ts')}.")
            else:
                self._webhook(payload)
                record.update(result="sent", detail="Posted through the incoming webhook.")
        except SlackError as error:
            record.update(result="error", detail=str(error))
        self.audit.append(record)
        return record

    # -- transport ---------------------------------------------------------

    def _api(self, method: str, body: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{API}/{method}",
            data=json.dumps(body).encode(),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.config.bot_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        data = self._open_json(request)
        if not data.get("ok"):
            raise SlackError(f"Slack {method} failed: {data.get('error', 'unknown_error')}")
        return data

    def _webhook(self, payload: dict[str, Any]) -> None:
        if not self.config.webhook_url.startswith("https://hooks.slack.com/"):
            raise SlackError("SLACK_WEBHOOK_URL must start with https://hooks.slack.com/.")
        request = urllib.request.Request(
            self.config.webhook_url,
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with self.opener(request) as response:
                body = response.read().decode()
        except (urllib.error.URLError, TimeoutError) as error:
            raise SlackError(f"Webhook request failed: {error}") from error
        if body.strip() != "ok":
            raise SlackError(f"Webhook returned: {body[:120]}")

    def _open_json(self, request: urllib.request.Request) -> dict[str, Any]:
        try:
            with self.opener(request) as response:
                return json.loads(response.read().decode())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise SlackError(f"Could not reach Slack: {error}") from error


class SlackError(RuntimeError):
    pass
