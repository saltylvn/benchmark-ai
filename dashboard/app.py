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

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for

from . import auth
from .insights import DEFAULT_ASSUMPTIONS, DEFAULT_SNAPSHOT, build_view, load_json
from .portfolio import build_team_view
from .slack import SlackConfig, SlackConnector

RUNS = {"thursday": "08:47 request", "morning": "Morning plan"}


def slack_messages(run: dict[str, Any]) -> list[dict[str, str]]:
    """Messages a PM can approve for Slack: the executor's draft, and the brief."""
    messages = []
    for action in run["actions"]:
        if action["type"] == "slack.draft":
            messages.append({"id": "slack-draft", "label": f"Crew update for {action['channel']}", "text": action["text"]})
    brief = run.get("brief")
    if brief:
        lines = [f"*{brief['headline']}*"] + [f"{i}. {o}" for i, o in enumerate(brief["outcomes"], 1)]
        if brief.get("watchouts"):
            lines.append("_Watch:_ " + " ".join(brief["watchouts"]))
        messages.append({"id": "brief", "label": "Morning brief", "text": "\n".join(lines)})
    return messages


def provider_cards(env: dict[str, str] | None = None) -> list[dict[str, Any]]:
    env = dict(os.environ if env is None else env)
    return [
        {"id": p.id, "label": p.label, "why": p.why, "env": p.env, "ready": p.configured(env)}
        for p in auth.providers(env)
    ]


def create_app(
    snapshot_path: Path | str = DEFAULT_SNAPSHOT,
    assumptions_path: Path | str = DEFAULT_ASSUMPTIONS,
    slack: SlackConnector | None = None,
    env: dict[str, str] | None = None,
    auth_opener: auth.Opener | None = None,
) -> Flask:
    env = dict(os.environ if env is None else env)
    app = Flask(__name__)
    app.json.ensure_ascii = False  # show "09:00–09:40", not "–", in payload previews
    app.secret_key = env.get("DASHBOARD_SECRET") or secrets.token_hex(32)
    app.config.update(
        FORM_TOKEN=secrets.token_urlsafe(16),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=env.get("PUBLIC_URL", "").startswith("https://"),
        PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    )
    connector = slack or SlackConnector(SlackConfig.from_env(env))
    app.extensions["slack"] = connector
    approvals: dict[str, dict[str, Any]] = {}
    app.extensions["approvals"] = approvals
    opener = auth_opener or auth._default_opener

    def view(run_key: str) -> dict[str, Any]:
        if run_key not in RUNS:
            abort(404)
        # Re-read on every request so a fresh `npm run export:dashboard` or an
        # edited assumptions.json shows up on reload.
        return build_view(load_json(Path(snapshot_path)), load_json(Path(assumptions_path)), run_key)

    def current_user() -> dict[str, str] | None:
        return session.get("user")

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
        base = env.get("PUBLIC_URL", "").rstrip("/")
        path = url_for("auth_callback", provider_id=provider_id)
        return f"{base}{path}" if base else url_for("auth_callback", provider_id=provider_id, _external=True)

    # -- welcome and sign-in -----------------------------------------------

    @app.get("/")
    def index():
        user = current_user()
        if not user:
            return render_template("index.html", page="welcome", providers=provider_cards(env), static_mode=False)
        snapshot = load_json(Path(snapshot_path))
        assumptions = load_json(Path(assumptions_path))
        status = connector.status()
        return render_template(
            "index.html",
            page="app",
            static_mode=False,
            v=build_view(snapshot, assumptions, "thursday"),
            t=build_team_view(snapshot, assumptions),
            runs=RUNS,
            user=user,
            slack=status,
            audit=list(reversed(connector.audit))[:8],
            approvals=approvals,
            form_token=app.config["FORM_TOKEN"],
        )

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

    @app.get("/logout")
    def logout():
        session.clear()
        return redirect(url_for("index"))

    def approvable(item_id: str) -> dict[str, Any] | None:
        """Find what an approval refers to: a Coordinator draft, the digest, the day rewrite, or a heads-up."""
        snapshot = load_json(Path(snapshot_path))
        sweep = snapshot["portfolio"]["sweep"]
        if item_id == "digest":
            return {"label": "Team status digest", "slack": sweep["digest"]}
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

    @app.post("/api/approve")
    @signed_in
    def api_approve():
        if request.headers.get("X-Form-Token") != app.config["FORM_TOKEN"]:
            return jsonify({"error": "This page is out of date"}), 400
        body = request.get_json(silent=True) or {}
        item_id, act = str(body.get("id", "")), body.get("act")
        if act not in ("approve", "skip"):
            return jsonify({"error": "Unknown action"}), 400
        item = approvable(item_id)
        if item is None:
            return jsonify({"error": "That item is no longer in today's sweep"}), 404
        user = current_user()
        record = {"act": act, "by": user["name"], "at": datetime.now().strftime("%-I:%M %p"), "detail": ""}
        if act == "approve" and item["slack"]:
            if user["provider"] == "demo":
                result = connector.preview(item["slack"], context=item["label"], approved_by=user["name"])
            else:
                result = connector.send(item["slack"], context=item["label"], approved_by=f"{user['name']} ({user['email']})")
            record["detail"] = {"sent": "Posted to Slack", "dry-run": "Preview only: nothing was posted", "error": result["detail"]}[result["result"]]
            if result["result"] == "error":
                return jsonify({"error": result["detail"]}), 502
        elif act == "approve":
            record["detail"] = "Saved as approved. Calendar, email, and invoices stay drafts in this demo"
        approvals[item_id] = record
        return jsonify(record)

    # -- JSON API: the same data the page renders --------------------------

    @app.get("/api/runs/<run_key>")
    @signed_in
    def api_run(run_key: str):
        data = view(run_key)
        return jsonify({k: data[k] for k in ("insights", "ledger", "changes", "agents", "handoffs", "compliance", "guardrails")})

    @app.get("/api/team")
    @signed_in
    def api_team():
        t = build_team_view(load_json(Path(snapshot_path)), load_json(Path(assumptions_path)))
        return jsonify({k: t[k] for k in ("queue", "board", "timeline", "counts", "team", "subs", "steps", "ledger", "digest")})

    @app.get("/api/snapshot")
    @signed_in
    def api_snapshot():
        return jsonify(load_json(Path(snapshot_path)))

    @app.get("/api/slack/status")
    @signed_in
    def api_slack_status():
        return jsonify(connector.status())

    @app.get("/api/slack/audit")
    @signed_in
    def api_slack_audit():
        return jsonify(connector.audit)

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return app
