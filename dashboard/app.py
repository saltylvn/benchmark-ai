"""Benchmark PM dashboard: what the agent team did, and why, on one page.

Run from the repo root:

    python -m dashboard            # http://127.0.0.1:5050
"""

from __future__ import annotations

import os
import secrets
from pathlib import Path
from typing import Any

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, url_for

from .insights import DEFAULT_ASSUMPTIONS, DEFAULT_SNAPSHOT, build_view, load_json
from .slack import SlackConfig, SlackConnector

RUNS = {"warRoom": "War room · 08:47 request", "morning": "Morning plan · before the request"}


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


def create_app(
    snapshot_path: Path | str = DEFAULT_SNAPSHOT,
    assumptions_path: Path | str = DEFAULT_ASSUMPTIONS,
    slack: SlackConnector | None = None,
) -> Flask:
    app = Flask(__name__)
    app.json.ensure_ascii = False  # show "09:00–09:40", not "–", in payload previews
    app.secret_key =os.environ.get("DASHBOARD_SECRET") or secrets.token_hex(16)
    app.config["FORM_TOKEN"] = secrets.token_urlsafe(16)
    connector = slack or SlackConnector(SlackConfig.from_env())
    app.extensions["slack"] = connector

    def view(run_key: str) -> dict[str, Any]:
        if run_key not in RUNS:
            abort(404)
        # Re-read on every request so a fresh `npm run export:dashboard` or an
        # edited assumptions.json shows up on reload.
        return build_view(load_json(Path(snapshot_path)), load_json(Path(assumptions_path)), run_key)

    @app.get("/")
    def index():
        run_key = request.args.get("run", "warRoom")
        data = view(run_key)
        return render_template(
            "index.html",
            v=data,
            runs=RUNS,
            slack=connector.status(),
            messages=slack_messages(data["run"]),
            audit=list(reversed(connector.audit))[:8],
            form_token=app.config["FORM_TOKEN"],
        )

    @app.post("/slack/send")
    def slack_send():
        if request.form.get("token") != app.config["FORM_TOKEN"]:
            abort(400, "Stale form. Reload the dashboard.")
        run_key = request.form.get("run", "warRoom")
        run = view(run_key)["run"]
        message = next((m for m in slack_messages(run) if m["id"] == request.form.get("message")), None)
        if message is None:
            abort(400, "Unknown message.")
        approver = (request.form.get("approved_by") or run["persona"]).strip()[:60]
        result = connector.send(message["text"], context=f"{RUNS[run_key]} · {message['label']}", approved_by=approver)
        flash(f"{message['label']}: {result['result']}. {result['detail']}", result["result"])
        return redirect(url_for("index", run=run_key) + "#slack")

    # -- JSON API: the same data the page renders --------------------------

    @app.get("/api/runs/<run_key>")
    def api_run(run_key: str):
        data = view(run_key)
        return jsonify({k: data[k] for k in ("insights", "ledger", "changes", "agents", "handoffs", "compliance", "guardrails")})

    @app.get("/api/snapshot")
    def api_snapshot():
        return jsonify(load_json(Path(snapshot_path)))

    @app.get("/api/slack/status")
    def api_slack_status():
        return jsonify(connector.status())

    @app.get("/api/slack/audit")
    def api_slack_audit():
        return jsonify(connector.audit)

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    return app
