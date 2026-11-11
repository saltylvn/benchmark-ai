"""Benchmark PM dashboard: what the agent team did, and why, on one page.

Run from the repo root:

    python -m dashboard            # http://127.0.0.1:5050
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta
from functools import wraps
from pathlib import Path
from typing import Any

from flask import Flask, abort, flash, g, jsonify, redirect, render_template, request, session, url_for

from . import auth
from .automation import Webhooks, token_ok, token_status
from .insights import DEFAULT_ASSUMPTIONS, DEFAULT_SNAPSHOT, SnapshotError, build_view, load_json, load_snapshot
from .store import JsonStore
from .brief import build_brief, send_brief, with_brief
from .portfolio import build_team_view, client_view, landing
from .slack import SlackConfig, SlackConnector

RUNS = {"thursday": "08:47 request", "morning": "Morning plan"}


def provider_cards(env: dict[str, str] | None = None) -> list[dict[str, Any]]:
    env = dict(os.environ if env is None else env)
    return [
        {"id": p.id, "label": p.label, "why": p.why, "env": p.env, "ready": p.configured(env)}
        for p in auth.providers(env)
    ]


def public_url(env: dict[str, str]) -> str:
    """The site's public address: PUBLIC_URL if set, else the one Render provides."""
    return (env.get("PUBLIC_URL") or env.get("RENDER_EXTERNAL_URL") or "").rstrip("/")


def create_app(
    snapshot_path: Path | str = DEFAULT_SNAPSHOT,
    assumptions_path: Path | str = DEFAULT_ASSUMPTIONS,
    slack: SlackConnector | None = None,
    env: dict[str, str] | None = None,
    auth_opener: auth.Opener | None = None,
    state_dir: Path | str | None = None,
    webhook_opener: Any = None,
    webhook_background: bool = True,
) -> Flask:
    env = dict(os.environ if env is None else env)
    app = Flask(__name__)
    app.json.ensure_ascii = False  # show "09:00–09:40", not "–", in payload previews
    app.secret_key = env.get("DASHBOARD_SECRET") or secrets.token_hex(32)
    https = public_url(env).startswith("https://")
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=https,
        # "__Host-" makes the browser refuse the cookie unless it is Secure, host-only and Path=/.
        SESSION_COOKIE_NAME="__Host-benchmark" if https else "benchmark",
        PERMANENT_SESSION_LIFETIME=timedelta(days=14),
        # JSON bodies here are a few hundred bytes; refuse anything large before it is parsed.
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    connector = slack or SlackConnector(SlackConfig.from_env(env))
    app.extensions["slack"] = connector
    # Approvals and the Slack log survive restarts when a state dir is set (python -m dashboard sets one).
    store = JsonStore(Path(state_dir) / "state.json" if state_dir else None)
    app.extensions["store"] = store
    connector.audit = store.get("slackLog", []) or connector.audit
    connector.on_record = lambda record: store.append("slackLog", record)
    hooks = Webhooks.from_env(
        env,
        opener=webhook_opener,
        background=webhook_background,
        on_log=lambda record: store.append("webhookLog", record, keep=100),
    )
    app.extensions["webhooks"] = hooks

    def snapshot() -> dict[str, Any]:
        return load_snapshot(Path(snapshot_path))

    def approvals_for(day: str) -> dict[str, Any]:
        # Demo visitors each start fresh: their approvals live in their own session, never the shared store.
        user = current_user()
        if user and user["provider"] == "demo":
            return dict(session.get("demoApprovals", {}))
        return store.get("approvals", {}).get(day, {})

    def csrf_token() -> str:
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(24)
        return session["csrf"]

    def asset(filename: str) -> str:
        """Static URL stamped with the file's mtime, so a phone never keeps a stale stylesheet."""
        try:
            stamp = int(Path(app.static_folder, filename).stat().st_mtime)
        except OSError:
            stamp = 0
        return url_for("static", filename=filename, v=stamp)

    app.jinja_env.globals["asset"] = asset

    @app.context_processor
    def site():
        # Link previews (LinkedIn, Slack, iMessage) need absolute URLs.
        return {"site_url": public_url(env) or request.url_root.rstrip("/")}

    def csp_nonce() -> str:
        """One random nonce per response; only <script> tags that carry it may run."""
        if "csp_nonce" not in g:
            g.csp_nonce = secrets.token_urlsafe(18)
        return g.csp_nonce

    app.jinja_env.globals["csp_nonce"] = csp_nonce

    @app.after_request
    def security_headers(response):
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "same-origin")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
        if https:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        # Inline scripts run only with this response's nonce; no 'unsafe-inline' for scripts.
        h.setdefault(
            "Content-Security-Policy",
            f"default-src 'self'; script-src 'self' 'nonce-{csp_nonce()}'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
        )
        if request.path.startswith("/api/"):
            h.setdefault("Cache-Control", "no-store")
        return response

    @app.errorhandler(SnapshotError)
    def snapshot_error(error):
        return f"<h1>Benchmark needs fresh data</h1><p>{error}</p>", 503
    opener = auth_opener or auth._default_opener

    def view(run_key: str) -> dict[str, Any]:
        if run_key not in RUNS:
            abort(404)
        # Re-read on every request so a fresh `npm run export:dashboard` or an
        # edited assumptions.json shows up on reload.
        return build_view(snapshot(), load_json(Path(assumptions_path)), run_key)

    def current_user() -> dict[str, str] | None:
        return session.get("user")

    SLACK_FAILED = "Slack did not accept the message. A teammate can see why in the Slack log."

    def is_staff(user: dict[str, str] | None) -> bool:
        """A real, signed-in teammate. Demo visitors can click around but never see team data."""
        return bool(user) and user.get("provider") != "demo"

    def visible_audit(user: dict[str, str] | None) -> list[dict[str, Any]]:
        # Real sends name the approver and their email, so only teammates see them.
        return list(connector.audit) if is_staff(user) else [r for r in connector.audit if r.get("mode") == "demo"]

    def visible_status(user: dict[str, str] | None) -> dict[str, Any]:
        status = connector.status()
        if is_staff(user):
            return status
        return {k: status[k] for k in ("mode", "connected", "sendEnabled") if k in status}

    def signed_in(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not current_user():
                if request.path.startswith("/api/"):
                    return jsonify({"error": "Sign in or open the demo first."}), 401
                return redirect(url_for("index"))
            return fn(*args, **kwargs)

        return wrapper

    def callback_url(provider_id: str) -> str:
        base = public_url(env)
        path = url_for("auth_callback", provider_id=provider_id)
        return f"{base}{path}" if base else url_for("auth_callback", provider_id=provider_id, _external=True)

    # -- welcome and sign-in -----------------------------------------------

    @app.get("/")
    def index():
        user = current_user()
        if not user:
            snap = snapshot()
            return render_template("index.html", page="welcome", providers=provider_cards(env), static_mode=False, landing=landing(snap, load_json(Path(assumptions_path))))
        snap = snapshot()
        assumptions = load_json(Path(assumptions_path))
        status = visible_status(user)
        return render_template(
            "index.html",
            page="app",
            static_mode=False,
            v=build_view(snap, assumptions, "thursday"),
            t=with_brief(build_team_view(snap, assumptions), snap, assumptions),
            brief_at=env.get("BRIEF_AT", "").strip(),
            user=user,
            slack=status,
            audit=list(reversed(visible_audit(user)))[:8],
            approvals=approvals_for(snap["portfolio"]["sweep"]["today"]),
            form_token=csrf_token(),
        )

    @app.get("/jobs/<job_id>/client")
    @signed_in
    def client_page(job_id: str):
        data = client_view(snapshot(), job_id)
        if data is None:
            abort(404)
        return render_template("client.html", c=data)

    @app.get("/demo")
    def demo():
        session.clear()
        session["user"] = dict(auth.DEMO_USER)
        return redirect(url_for("index"))

    @app.get("/login/<provider_id>")
    def login(provider_id: str):
        provider = auth.provider_by_id(provider_id, env)
        if provider is None:
            abort(404)
        if not provider.configured(env):
            flash(f"{provider.label} sign-in is not set up yet. Add {provider.env}_CLIENT_ID and {provider.env}_CLIENT_SECRET to .env, or view the demo.", "info")
            return redirect(url_for("index"))
        state = auth.new_state()
        session["oauth"] = {"state": state, "provider": provider.id}
        return redirect(auth.authorize_redirect(provider, callback_url(provider.id), state, env))

    @app.get("/auth/<provider_id>/callback")
    def auth_callback(provider_id: str):
        pending = session.pop("oauth", None)
        provider = auth.provider_by_id(provider_id, env)
        if provider is None:
            abort(404)
        if request.args.get("error"):
            flash(f"{provider.label} sign-in was cancelled.", "info")
            return redirect(url_for("index"))
        if not pending or pending["provider"] != provider_id or not secrets.compare_digest(pending["state"], request.args.get("state", "")):
            flash("That sign-in link expired. Try again.", "error")
            return redirect(url_for("index"))
        try:
            user = auth.exchange_and_identify(provider, request.args.get("code", ""), callback_url(provider.id), env, opener)
        except auth.AuthError as error:
            flash(str(error), "error")
            return redirect(url_for("index"))
        session.clear()
        session.permanent = True
        session["user"] = user
        return redirect(url_for("index"))

    @app.post("/logout")
    def logout():
        # POST with the page token, so another site cannot sign a person out with a link or image.
        expected = session.get("csrf")
        if expected and secrets.compare_digest(request.form.get("csrf", ""), expected):
            session.clear()
        return redirect(url_for("index"))

    def approvable(item_id: str) -> dict[str, Any] | None:
        """Find what an approval refers to: a Coordinator draft, the digest, the day rewrite, or a heads-up."""
        snap = snapshot()
        sweep = snap["portfolio"]["sweep"]
        if item_id == "digest":
            return {"label": "Morning brief", "slack": build_brief(snap, load_json(Path(assumptions_path)))}
        if item_id == "day-maria":
            return {"label": "Maria's rewritten day", "slack": None}
        draft = next((d for d in sweep["drafts"] if d["id"] == item_id), None)
        if draft:
            text = f"_For {draft['to']}:_ {draft['body']}" if draft["kind"] == "slack" else None
            return {"label": draft["subject"], "slack": text}
        risk = next((r for r in sweep["risks"] if r["id"] == item_id), None)
        if risk:
            return {"label": risk["title"], "slack": None}
        return None

    def record_approval(item_id: str, act: Any, user: dict[str, str], via: str) -> tuple[dict[str, Any], int]:
        """The one place an approval happens: from the page, or from an automation acting for a named person."""
        if act not in ("approve", "skip"):
            return {"error": "Unknown action"}, 400
        item = approvable(item_id)
        if item is None:
            return {"error": "That item is no longer in today's sweep"}, 404
        record = {"act": act, "by": user["name"], "at": datetime.now().strftime("%-I:%M %p"), "detail": "", "via": via}
        if act == "approve" and item["slack"]:
            if user["provider"] == "demo":
                result = connector.preview(item["slack"], context=item["label"], approved_by=user["name"])
            else:
                result = connector.send(item["slack"], context=item["label"], approved_by=f"{user['name']} ({user['email']})")
            record["detail"] = {"sent": "Posted to Slack", "dry-run": "Preview only: nothing was posted", "error": result["detail"]}[result["result"]]
            if result["result"] == "error":
                return {"error": SLACK_FAILED}, 502
        elif act == "approve":
            record["detail"] = "Saved as approved. Calendar, email, and invoices stay drafts in this demo"
        day = snapshot()["portfolio"]["sweep"]["today"]
        if user["provider"] == "demo":
            session["demoApprovals"] = {**session.get("demoApprovals", {}), item_id: record}
        else:
            store.put_in(["approvals", day, item_id], record)
            # Demo clicks stay private to the visitor; real approvals are announced to automations.
            hooks.emit("approval.recorded", {"day": day, "item": {"id": item_id, "label": item["label"]}, **record, "provider": user["provider"]})
        return record, 200

    @app.post("/api/approve")
    @signed_in
    def api_approve():
        expected = session.get("csrf")
        if not expected or not secrets.compare_digest(request.headers.get("X-Form-Token", ""), expected):
            return jsonify({"error": "This page is out of date"}), 400
        body = request.get_json(silent=True) or {}
        record, status = record_approval(str(body.get("id", "")), body.get("act"), current_user(), "app")
        return jsonify(record), status

    # -- Automation API (/api/v1): bearer token, for n8n, GitHub Actions, scripts ---

    def machine(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            state = token_status(env)
            if state != "ok":
                why = "AUTOMATION_TOKEN is not set." if state == "off" else "AUTOMATION_TOKEN must be at least 32 characters."
                return jsonify({"error": f"The automation API is off. {why}"}), 503
            if not token_ok(env, request.headers.get("Authorization")):
                return jsonify({"error": "Missing or wrong bearer token."}), 401
            return fn(*args, **kwargs)

        return wrapper

    def queue_item(i: dict[str, Any]) -> dict[str, Any]:
        keys = ("id", "kind", "kindLabel", "level", "owner", "ownerName", "jobId", "title", "why", "due", "dueLabel", "channel", "to", "subject", "amount", "minutes")
        return {k: i.get(k) for k in keys}

    @app.get("/api/v1/morning")
    @machine
    def v1_morning():
        snap = snapshot()
        assumptions = load_json(Path(assumptions_path))
        t = build_team_view(snap, assumptions)
        day = snap["portfolio"]["sweep"]["today"]
        done = store.get("approvals", {}).get(day, {})
        waiting = [queue_item(i) for i in t["queue"] if i["id"] not in done]
        return jsonify({
            "date": day,
            "company": t["company"],
            "jobs": t["counts"],
            "blocked": sum(1 for i in waiting if i["level"] == "blocked"),
            "waiting": len(waiting),
            "estimatedMinutesDrafted": round(sum(i["minutes"] or 0 for i in waiting)),
            "sinceYesterday": t["since"]["counts"],
            "items": waiting,
            "brief": build_brief(snap, assumptions),
        })

    @app.get("/api/v1/queue")
    @machine
    def v1_queue():
        snap = snapshot()
        t = build_team_view(snap, load_json(Path(assumptions_path)))
        owner, level = request.args.get("owner"), request.args.get("level")
        items = [queue_item(i) for i in t["queue"] if owner in (None, i["owner"]) and level in (None, i["level"])]
        return jsonify({"date": snap["portfolio"]["sweep"]["today"], "items": items})

    @app.post("/api/v1/brief/send")
    @machine
    def v1_brief_send():
        body = request.get_json(silent=True) or {}
        snap = snapshot()
        day = snap["portfolio"]["sweep"]["today"]
        if store.get("briefSent") == day and not body.get("force"):
            return jsonify({"result": "already-sent", "date": day})
        result = send_brief(connector, build_brief(snap, load_json(Path(assumptions_path))))
        if result["result"] == "error":
            return jsonify({"result": "error", "detail": SLACK_FAILED}), 502
        if result["result"] == "sent":
            store.set("briefSent", day)
            hooks.emit("brief.sent", {"day": day, "channel": connector.config.channel})
        return jsonify({"result": result["result"], "detail": result["detail"], "date": day})

    @app.post("/api/v1/approvals")
    @machine
    def v1_approve():
        body = request.get_json(silent=True) or {}
        by = body.get("by") or {}
        name, email = str(by.get("name", "")).strip(), str(by.get("email", "")).strip()
        if not name or "@" not in email:
            return jsonify({"error": "Say who approved it: by.name and by.email are required."}), 400
        try:
            auth.check_allowed(email, env)
        except auth.AuthError:
            return jsonify({"error": "That person is not on this team's sign-in list."}), 403
        record, status = record_approval(str(body.get("id", "")), body.get("act"), {"name": name[:80], "email": email[:120], "provider": "automation"}, "api")
        return jsonify(record), status

    # -- JSON API: the same data the page renders --------------------------

    @app.get("/api/runs/<run_key>")
    @signed_in
    def api_run(run_key: str):
        data = view(run_key)
        return jsonify({k: data[k] for k in ("insights", "ledger", "changes", "agents", "handoffs", "compliance", "guardrails")})

    @app.get("/api/team")
    @signed_in
    def api_team():
        t = build_team_view(snapshot(), load_json(Path(assumptions_path)))
        return jsonify({k: t[k] for k in ("queue", "board", "timeline", "counts", "team", "subs", "steps", "ledger", "digest")})

    @app.get("/api/snapshot")
    @signed_in
    def api_snapshot():
        return jsonify(snapshot())

    @app.get("/api/slack/status")
    @signed_in
    def api_slack_status():
        return jsonify(visible_status(current_user()))

    @app.get("/api/slack/audit")
    @signed_in
    def api_slack_audit():
        return jsonify(visible_audit(current_user()))

    @app.get("/healthz")
    def healthz():
        # Render restarts the service if this fails, so it checks the data the pages need.
        snapshot()
        return {"ok": True}

    return app
