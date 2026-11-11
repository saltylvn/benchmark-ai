"""Automation surface: a token-protected API for machines and signed outbound webhooks.

Benchmark's rule still holds here: automations can read the morning, post the
internal brief, and record an approval made by a named person (for example a
PM tapping a button in n8n or Slack). Nothing approves itself.

    AUTOMATION_TOKEN   bearer token for /api/v1/* (32+ characters). Unset = API off.
    WEBHOOK_URLS       comma-separated https endpoints that receive events.
    WEBHOOK_SECRET     shared secret for the X-Benchmark-Signature HMAC.

Events: ``approval.recorded`` and ``brief.sent``. Each delivery is signed:

    X-Benchmark-Timestamp: <unix seconds>
    X-Benchmark-Signature: sha256=<hex HMAC-SHA256(secret, f"{timestamp}.{body}")>

The body is canonical JSON (sorted keys, no spaces, UTF-8, whole numbers as
integers) so a receiver can rebuild it with ``JSON.stringify`` in n8n or
``json.dumps`` in Python and get the same bytes.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

MIN_TOKEN = 32
MAX_ATTEMPTS = 3
TIMEOUT = 5.0
SIGNATURE_TOLERANCE = 300  # seconds a receiver should accept

Opener = Callable[..., Any]


# ---------------------------------------------------------------------------
# Inbound: bearer token


def token_status(env: dict[str, str]) -> str:
    token = env.get("AUTOMATION_TOKEN", "")
    if not token:
        return "off"
    return "ok" if len(token) >= MIN_TOKEN else "weak"


def token_ok(env: dict[str, str], header: str | None) -> bool:
    token = env.get("AUTOMATION_TOKEN", "")
    if len(token) < MIN_TOKEN or not header or not header.startswith("Bearer "):
        return False
    return secrets.compare_digest(header[len("Bearer "):].strip(), token)


# ---------------------------------------------------------------------------
# Outbound: canonical JSON, signatures, delivery


def _normalize(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    return value


def canonical(payload: dict[str, Any]) -> str:
    return json.dumps(_normalize(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sign(secret: str, timestamp: int, body: str) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.{body}".encode(), hashlib.sha256)
    return "sha256=" + mac.hexdigest()


def verify(secret: str, timestamp: str, body: str, signature: str, now: float | None = None) -> bool:
    """Reference check for receivers: right secret, untampered body, recent timestamp."""
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs((now or time.time()) - ts) > SIGNATURE_TOLERANCE:
        return False
    return hmac.compare_digest(sign(secret, ts, body), signature or "")


def allowed_url(url: str) -> bool:
    """https anywhere; plain http only to this machine, for local testing."""
    parts = urlparse(url)
    if parts.scheme == "https" and parts.netloc:
        return True
    return parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1")


class Webhooks:
    """Fire-and-forget delivery with retries. Every attempt is logged; a slow receiver never blocks a page."""

    def __init__(
        self,
        urls: list[str],
        secret: str,
        opener: Opener | None = None,
        background: bool = True,
        on_log: Callable[[dict[str, Any]], None] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.time,
    ):
        self.urls = [u for u in urls if allowed_url(u)]
        self.rejected = [u for u in urls if not allowed_url(u)]
        self.secret = secret
        self.opener = opener or urllib.request.urlopen
        self.background = background
        self.on_log = on_log
        self.sleep = sleep
        self.clock = clock

    @classmethod
    def from_env(cls, env: dict[str, str], **kwargs: Any) -> Webhooks:
        urls = [u.strip() for u in env.get("WEBHOOK_URLS", "").split(",") if u.strip()]
        return cls(urls, env.get("WEBHOOK_SECRET", ""), **kwargs)

    @property
    def enabled(self) -> bool:
        return bool(self.urls and self.secret)

    def emit(self, event: str, data: dict[str, Any]) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        envelope = {"id": str(uuid.uuid4()), "event": event, "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "data": data}
        body = canonical(envelope)
        for url in self.urls:
            if self.background:
                threading.Thread(target=self._deliver, args=(url, event, envelope["id"], body), daemon=True).start()
            else:
                self._deliver(url, event, envelope["id"], body)
        return envelope

    def _deliver(self, url: str, event: str, delivery: str, body: str) -> None:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            ts = int(self.clock())
            request = urllib.request.Request(
                url,
                data=body.encode(),
                method="POST",
                headers={
                    "Content-Type": "application/json; charset=utf-8",
                    "User-Agent": "Benchmark-Webhooks/1",
                    "X-Benchmark-Event": event,
                    "X-Benchmark-Delivery": delivery,
                    "X-Benchmark-Timestamp": str(ts),
                    "X-Benchmark-Signature": sign(self.secret, ts, body),
                },
            )
            status, error = None, None
            try:
                with self.opener(request, timeout=TIMEOUT) as response:
                    status = getattr(response, "status", 200)
            except urllib.error.HTTPError as exc:
                status, error = exc.code, f"HTTP {exc.code}"
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                error = str(getattr(exc, "reason", exc))[:200]
            ok = status is not None and 200 <= status < 300
            self._log({"event": event, "delivery": delivery, "url": _redact(url), "attempt": attempt, "status": status, "ok": ok, "error": error})
            # Retry network errors and 5xx/429; a 4xx means the receiver rejected it on purpose.
            if ok or (status is not None and 400 <= status < 500 and status != 429):
                return
            if attempt < MAX_ATTEMPTS:
                self.sleep(2 ** (attempt - 1))

    def _log(self, record: dict[str, Any]) -> None:
        record["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if self.on_log:
            self.on_log(record)


def _redact(url: str) -> str:
    """Keep the host and path; drop query strings, which often carry tokens."""
    parts = urlparse(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"
