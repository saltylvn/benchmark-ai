"""Production entry point: ``gunicorn dashboard.wsgi:app``.

Used on Render (see render.yaml). One worker on purpose: approvals are kept in a
JSON file under a lock, and the 8:00 brief scheduler must run exactly once.
Threads give the concurrency a small team needs.
"""

from __future__ import annotations

import os

from werkzeug.middleware.proxy_fix import ProxyFix

from .app import create_app
from .store import DEFAULT_STATE_DIR

app = create_app(state_dir=os.environ.get("DASHBOARD_STATE_DIR") or DEFAULT_STATE_DIR)
# Render (and most hosts) terminate HTTPS at a proxy; trust its one hop so links and cookies say https.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

if os.environ.get("BRIEF_AT", "").strip():
    from .brief import start_scheduler

    start_scheduler(app.extensions["slack"], os.environ["BRIEF_AT"].strip())
