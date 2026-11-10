"""Write the dashboard as one self-contained, read-only HTML file.

    python -m dashboard.static_export [out.html]

The file opens on a welcome card, then shows either run, picked by
``#run-thursday`` or ``#run-morning``. It has no server calls, so it can be
hosted anywhere and opened on a phone or iPad. Approvals and sign-in stay in the
live dashboard.
"""

from __future__ import annotations

import sys
from pathlib import Path

from flask import render_template

from .app import RUNS, create_app, provider_cards, slack_messages
from .insights import DEFAULT_ASSUMPTIONS, DEFAULT_SNAPSHOT, HERE, build_view, load_json

STATIC_SLACK = {
    "connected": False,
    "mode": "none",
    "sendEnabled": False,
    "channel": None,
    "detail": "Read-only copy. Slack status and sending live in the dashboard server.",
}


def render_static(snapshot_path: Path = DEFAULT_SNAPSHOT, assumptions_path: Path = DEFAULT_ASSUMPTIONS) -> str:
    app = create_app(snapshot_path, assumptions_path, env={})
    snapshot, assumptions = load_json(snapshot_path), load_json(assumptions_path)
    views = []
    with app.test_request_context("/"):
        for key in RUNS:
            v = build_view(snapshot, assumptions, key)
            views.append(
                {
                    "key": key,
                    "html": render_template(
                        "_dashboard.html",
                        static_mode=True,
                        v=v,
                        runs=RUNS,
                        user=None,
                        slack=STATIC_SLACK,
                        can_send=False,
                        messages=slack_messages(v["run"]),
                        audit=[],
                        form_token="",
                    ),
                }
            )
        welcome = render_template("_welcome.html", static_mode=True, providers=provider_cards({}))
        return render_template(
            "static.html",
            css=(HERE / "static" / "dashboard.css").read_text(encoding="utf-8"),
            views=views,
            welcome=welcome,
        )


def main(argv: list[str]) -> int:
    out = Path(argv[0] if argv else "dashboard/dist/benchmark-dashboard.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_static(), encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
