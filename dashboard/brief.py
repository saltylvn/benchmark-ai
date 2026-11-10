"""The 8:00 morning brief: what needs you, what's slipping, and where every job stands.

    python -m dashboard.brief                 # print the team brief
    python -m dashboard.brief --for maria     # one PM's brief
    python -m dashboard.brief --send          # post it to SLACK_CHANNEL (needs SLACK_SEND_ENABLED=1)

Set ``BRIEF_AT=08:00`` and the dashboard server posts the team brief once a day
at that local time. It is the one automatic post Benchmark makes, and it only
goes to the internal team channel. Client emails, sub nudges, and invoices
still wait for a person to approve them.
"""

from __future__ import annotations

import argparse
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from collections.abc import Callable

from .insights import DEFAULT_ASSUMPTIONS, DEFAULT_SNAPSHOT, load_json, load_snapshot
from .portfolio import build_team_view, first
from .slack import SlackConfig, SlackConnector

MAX_ITEMS = 6


def build_brief(snapshot: dict[str, Any], assumptions: dict[str, Any], person: str | None = None) -> str:
    t = build_team_view(snapshot, assumptions)
    queue = [i for i in t["queue"] if person in (None, i["owner"])]
    blocked = [i for i in queue if i["level"] == "blocked"]
    name = t["people"][person]["name"] if person else None
    jobs = [c for col in t["board"] for c in col["jobs"] if person in (None, c["pm"])]

    lines = [
        f"*Good morning{', ' + first(name) if name else ''}. {t['todayLabel']}.*",
        f"{len(blocked)} blocked, {len(queue) - len(blocked)} more waiting. "
        f"About {round(sum(i['minutes'] for i in queue))} minutes of follow-ups are already drafted."
        if queue
        else "Nothing is waiting on you this morning.",
        "",
    ]
    if queue:
        lines.append("*Needs you first*")
        for i in queue[:MAX_ITEMS]:
            owner = "" if person else f" ({first(i['ownerName'])})"
            said = any(w in i["title"].lower() for w in ("today", "tomorrow"))
            due = f" · {i['dueLabel']}" if i.get("dueLabel") and not said else ""
            lines.append(f"• {i['title']}{owner}{due}")
        if len(queue) > MAX_ITEMS:
            lines.append(f"• …and {len(queue) - MAX_ITEMS} more in Today")
        lines.append("")

    order = {"behind": 0, "at-risk": 1, "on-track": 2}
    lines.append("*Jobs*")
    for c in sorted(jobs, key=lambda c: (order[c["status"]], c["jobId"])):
        mark = {"behind": "🔴", "at-risk": "🟠", "on-track": "🟢"}[c["status"]]
        who = "" if person else f" · {first(c['pmName'])}"
        lines.append(f"{mark} {c['jobId']} {c['name']}{who} · {c['percent']}% · {c['reason']}")

    if not person:
        heavy = [w for w in t["team"] if w["load"] == "heavy"]
        if heavy:
            lines += ["", "*Team*"] + [f"• {w['name']} is at {w['hours']} of {w['capacity']} h. A handoff is drafted in Team." for w in heavy]
    lines += ["", "_Open Benchmark to approve. Nothing has been sent to clients or subs._"]
    return "\n".join(lines)


def with_brief(t: dict[str, Any], snapshot: dict[str, Any], assumptions: dict[str, Any]) -> dict[str, Any]:
    """Put the real morning brief in the Messages tab's first card."""
    text = build_brief(snapshot, assumptions)
    for group in t["messages"]:
        for item in group["entries"]:
            if item["kind"] == "digest":
                item["body"] = text
    t["brief"] = text
    return t


def send_brief(connector: SlackConnector, text: str, label: str = "Morning brief") -> dict[str, Any]:
    return connector.send(text, context=label, approved_by="Benchmark schedule")


def start_scheduler(
    connector: SlackConnector,
    at: str,
    snapshot_path: Path = DEFAULT_SNAPSHOT,
    assumptions_path: Path = DEFAULT_ASSUMPTIONS,
    now: Callable[[], datetime] = datetime.now,
    sleep: Callable[[float], None] = time.sleep,
) -> threading.Thread:
    """Post the team brief once a day at ``at`` (HH:MM, local time)."""
    hour, minute = (int(x) for x in at.split(":"))
    state = {"last": None}

    def tick() -> bool:
        current = now()
        if (current.hour, current.minute) >= (hour, minute) and state["last"] != current.date():
            state["last"] = current.date()
            text = build_brief(load_snapshot(snapshot_path), load_json(assumptions_path))
            send_brief(connector, text, label=f"Morning brief {current:%a %b %d}")
            return True
        return False

    def loop() -> None:
        # Skip a brief that was due before the server started, so a restart at 9:30 doesn't post a stale one.
        start = now()
        if (start.hour, start.minute) > (hour, minute):
            state["last"] = start.date()
        while True:
            tick()
            sleep(30)

    thread = threading.Thread(target=loop, name="morning-brief", daemon=True)
    thread.tick = tick  # type: ignore[attr-defined]  # exposed for tests
    thread.start()
    return thread


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print or send the Benchmark morning brief.")
    parser.add_argument("--for", dest="person", help="PM id, e.g. maria")
    parser.add_argument("--send", action="store_true", help="post to Slack (needs SLACK_SEND_ENABLED=1)")
    args = parser.parse_args(argv)
    from .__main__ import load_dotenv

    load_dotenv(Path.cwd() / ".env")
    text = build_brief(load_snapshot(DEFAULT_SNAPSHOT), load_json(DEFAULT_ASSUMPTIONS), args.person)
    print(text)
    if args.send:
        result = send_brief(SlackConnector(SlackConfig.from_env()), text)
        print(f"\n[{result['result']}] {result['detail']}")
        return 0 if result["result"] != "error" else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
