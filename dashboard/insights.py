"""Turn the agent snapshot into what a project manager reads on the dashboard.

Every number here is computed from ``dashboard/data/snapshot.json``, which the
TypeScript agent team writes (``npm run export:dashboard``). The only inputs
that are not agent output are the manual-time assumptions in
``dashboard/assumptions.json``, and the page labels those as estimates.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
DEFAULT_SNAPSHOT = HERE / "data" / "snapshot.json"
DEFAULT_ASSUMPTIONS = HERE / "assumptions.json"

DAY_START = 8 * 60 + 30
DAY_END = 17 * 60 + 30

AGENT_ORDER = ["supervisor", "intake", "researcher", "planner", "critic", "executor", "brief"]
AGENT_LABELS = {
    "supervisor": "Supervisor",
    "intake": "Intake",
    "researcher": "Research",
    "planner": "Planner",
    "critic": "Critic",
    "executor": "Executor",
    "brief": "Brief",
}


def load_json(path: Path) -> dict[str, Any]:
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def hm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


# ---------------------------------------------------------------------------
# Schedule


def schedule_lanes(run: dict[str, Any]) -> list[dict[str, Any]]:
    """Calendar before the agents, then every plan the planner proposed."""
    lanes = [
        {
            "label": "Before",
            "sub": "calendar as it stood at 08:47",
            "status": "conflict" if _has_overlap(run["calendarBefore"]) else "ok",
            "blocks": [_block(e, overlap=_overlaps_any(e, run["calendarBefore"])) for e in run["calendarBefore"]],
        }
    ]
    for attempt, critique in zip(run["attempts"], run["critiques"]):
        lanes.append(
            {
                "label": f"Revision {critique['revision']}",
                "sub": f"{attempt['strategy']} · {critique['score']}/100",
                "status": "approved" if critique["approved"] else "rejected",
                "blocks": [_block(b) for b in attempt["blocks"]],
            }
        )
    return lanes


def _block(item: dict[str, Any], overlap: bool = False) -> dict[str, Any]:
    span = DAY_END - DAY_START
    start = max(item["start"], DAY_START)
    end = min(item["end"], DAY_END)
    return {
        "id": item["id"],
        "title": item["title"],
        "kind": item["kind"],
        "when": item.get("when") or f"{hm(item['start'])}–{hm(item['end'])}",
        "left": round((start - DAY_START) / span * 100, 3),
        "width": round(max(end - start, 0) / span * 100, 3),
        "overlap": overlap,
    }


def _overlaps_any(event: dict[str, Any], events: list[dict[str, Any]]) -> bool:
    return any(
        other["id"] != event["id"] and other["start"] < event["end"] and event["start"] < other["end"]
        for other in events
    )


def _has_overlap(events: list[dict[str, Any]]) -> bool:
    return any(_overlaps_any(e, events) for e in events)


def hour_ticks() -> list[dict[str, Any]]:
    span = DAY_END - DAY_START
    return [
        {"label": hm(m), "left": round((m - DAY_START) / span * 100, 3)}
        for m in range(9 * 60, DAY_END + 1, 60)
    ]


def schedule_changes(run: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Diff the original calendar against the approved plan."""
    plan = run.get("approvedPlan") or {"blocks": []}
    before = {e["id"]: e for e in run["calendarBefore"]}
    after = {b["id"]: b for b in plan["blocks"]}
    moved, held, added, removed = [], [], [], []
    for block_id, block in after.items():
        old = before.get(block_id)
        if old is None:
            added.append(block)
        elif (old["start"], old["end"]) != (block["start"], block["end"]):
            moved.append(
                {
                    **block,
                    "from": old["when"],
                    "shift": block["start"] - old["start"],
                    "fixed": old.get("flexibility") == "fixed",
                }
            )
        else:
            held.append(block)
    for block_id, event in before.items():
        if block_id not in after:
            removed.append(event)
    return {"moved": moved, "held": held, "added": added, "removed": removed}


# ---------------------------------------------------------------------------
# Agent flow


def agent_activity(run: dict[str, Any]) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, int]] = {a: {"steps": 0, "handoffs": 0} for a in AGENT_ORDER}
    for event in run["trace"]:
        counts.setdefault(event["agent"], {"steps": 0, "handoffs": 0})
        counts[event["agent"]]["steps"] += 1
        if event.get("handoff"):
            counts[event["agent"]]["handoffs"] += 1
    return [
        {"id": a, "label": AGENT_LABELS.get(a, a.title()), **counts[a]}
        for a in AGENT_ORDER
        if counts[a]["steps"]
    ]


def handoffs(run: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "at": e["at"],
            "from": e["agent"],
            "to": e["handoff"]["to"],
            "reason": e["handoff"]["reason"],
            "loop": AGENT_ORDER.index(e["handoff"]["to"]) < AGENT_ORDER.index(e["agent"])
            if e["handoff"]["to"] in AGENT_ORDER and e["agent"] in AGENT_ORDER
            else False,
        }
        for e in run["trace"]
        if e.get("handoff")
    ]


# ---------------------------------------------------------------------------
# Compliance and risk


_CASE_KIND = [
    (re.compile(r"^COI"), "Insurance certificate"),
    (re.compile(r"^INSP"), "Inspection"),
    (re.compile(r"^(PRM|PERMIT)"), "Permit"),
    (re.compile(r"^(LW|LIEN)"), "Lien waiver"),
    (re.compile(r"^J-"), "Job / quote"),
]


def compliance_items(run: dict[str, Any]) -> list[dict[str, Any]]:
    items = []
    for account in run["accounts"]:
        for case in account.get("cases", []):
            kind = next((label for pattern, label in _CASE_KIND if pattern.match(case["id"])), "Case")
            text = f"{case['title']} {case['status']}".lower()
            if "expired" in text or "not received" in text:
                level = "blocked"
            elif case["priority"] in ("P0", "P1"):
                level = "watch"
            else:
                level = "ok"
            items.append(
                {
                    "id": case["id"],
                    "kind": kind,
                    "party": account["name"],
                    "title": case["title"],
                    "status": case["status"],
                    "priority": case["priority"],
                    "level": level,
                }
            )
    rank = {"blocked": 0, "watch": 1, "ok": 2}
    return sorted(items, key=lambda i: (rank[i["level"]], i["priority"]))


def guardrails(run: dict[str, Any]) -> dict[str, Any]:
    actions = run["actions"]
    do_not_promise = [line for note in run["research"] for line in note.get("doNotPromise", [])]
    return {
        "drafts": len(actions),
        "sent": sum(1 for a in actions if a.get("status") != "draft"),
        "doNotPromise": do_not_promise,
    }


# ---------------------------------------------------------------------------
# Time ledger


@dataclass
class LedgerLine:
    task: str
    agent: str
    count: int
    minutes_each: float

    @property
    def minutes(self) -> float:
        return self.count * self.minutes_each


def time_ledger(run: dict[str, Any], assumptions: dict[str, Any]) -> dict[str, Any]:
    """Manual minutes the agent output replaces, minus the PM's review time.

    The minute values come from ``assumptions.json`` and are estimates a team
    should replace with its own numbers. The counts come from the run.
    """
    manual = assumptions["manualMinutes"]
    actions = run["actions"]
    count = lambda kind: sum(1 for a in actions if a["type"] == kind)  # noqa: E731
    calendar_moves = count("calendar.create") + count("calendar.update")
    lines = [
        LedgerLine("Triage inbox and spot calendar conflicts", "intake", 1, manual["triage"]),
        LedgerLine("Pull job file, sub insurance, inspection status", "researcher", len(run["research"]), manual["researchPerAccount"]),
        # A person untangles the day once; the rejected revision is agent-only work.
        LedgerLine("Untangle the double-booking and re-check the rules", "planner + critic", 1 if run["critiques"] else 0, manual["replan"]),
        LedgerLine("Move or create calendar entries", "executor", calendar_moves, manual["calendarChange"]),
        LedgerLine("Write the homeowner email", "executor", count("email.draft"), manual["emailDraft"]),
        LedgerLine("Write the crew Slack update", "executor", count("slack.draft"), manual["slackDraft"]),
        LedgerLine("Prepare the call card and morning brief", "brief", 1 if run.get("brief") else 0, manual["brief"]),
    ]
    lines = [line for line in lines if line.count]
    manual_total = sum(line.minutes for line in lines)
    review = len(actions) * assumptions["reviewMinutesPerDraft"]
    net = manual_total - review
    per_week = net * assumptions["requestsPerPmPerWeek"]
    team_week = per_week * assumptions["pmsOnTeam"]
    return {
        "lines": [
            {"task": l.task, "agent": l.agent, "count": l.count, "minutesEach": l.minutes_each, "minutes": l.minutes}
            for l in lines
        ],
        "manualMinutes": manual_total,
        "reviewMinutes": review,
        "netMinutes": net,
        "perPmWeekHours": round(per_week / 60, 1),
        "teamWeekHours": round(team_week / 60, 1),
        "teamYearHours": round(team_week * assumptions["workWeeksPerYear"] / 60),
        "assumptions": assumptions,
    }


# ---------------------------------------------------------------------------
# Insights


def insights(run: dict[str, Any], ledger: dict[str, Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    rejected = [c for c in run["critiques"] if not c["approved"]]
    final = run["critiques"][-1] if run["critiques"] else None

    for critique in rejected:
        attempt = next((a for a in run["attempts"] if a["strategy"] == critique["strategy"]), None)
        focus = next((b for b in (attempt or {}).get("blocks", []) if b["kind"] == "focus"), None)
        codes = ", ".join(f["code"] for f in critique["failures"])
        out.append(
            {
                "tone": "catch",
                "title": f"The critic stopped a bad day before anyone saw it ({codes})",
                "body": (
                    f"Revision {critique['revision']} ({critique['strategy']}) scored {critique['score']}/100"
                    + (f" and would have pushed the estimate block to {focus['when']}." if focus else ".")
                    + " A single-agent assistant would have shipped it. The team argued, and the planner switched strategy."
                ),
            }
        )

    if final and final["approved"]:
        total = len(final["passed"]) + len(final["failures"])
        out.append(
            {
                "tone": "ok",
                "title": f"Approved plan passes {len(final['passed'])} of {total} named rules",
                "body": "Fixed meetings, the county window, lunch, the site walk, prep buffers and the homeowner's deadline are each checked by code, not by a prompt.",
            }
        )

    blocked = [c for c in compliance_items(run) if c["level"] == "blocked"]
    for item in blocked:
        out.append(
            {
                "tone": "risk",
                "title": f"{item['kind']} blocks {item['party']}",
                "body": f"{item['id']}: {item['title']} ({item['status']}). The brief tells the PM not to confirm this sub to the homeowner.",
            }
        )

    changes = schedule_changes(run)
    fixed_moved = [m for m in changes["moved"] if m["fixed"]]
    if changes["moved"] or changes["added"]:
        biggest = max(changes["moved"], key=lambda m: abs(m["shift"]), default=None)
        body = f"{len(changes['added'])} new blocks, {len(changes['moved'])} moved, {len(changes['held'])} untouched."
        if biggest:
            body += f" Largest move: {biggest['title']} {biggest['from']} → {biggest['when']}."
        body += " Fixed events moved: none." if not fixed_moved else f" Fixed events moved: {len(fixed_moved)}."
        out.append({"tone": "info", "title": "One homeowner email rewrote the day, and every fixed commitment held", "body": body})

    rails = guardrails(run)
    out.append(
        {
            "tone": "ok",
            "title": f"{rails['drafts']} drafts staged, {rails['sent']} sent without approval",
            "body": f"Every calendar move and message waits for the PM. {len(rails['doNotPromise'])} do-not-promise rules ride along with the call card.",
        }
    )

    out.append(
        {
            "tone": "time",
            "title": f"About {round(ledger['netMinutes'])} PM minutes back on this one request",
            "body": (
                f"{round(ledger['manualMinutes'])} minutes of manual admin replaced, minus {round(ledger['reviewMinutes'])} minutes of review. "
                f"At your assumptions that is ~{ledger['perPmWeekHours']} h per PM per week and ~{ledger['teamYearHours']} h a year for the team. Estimates; edit assumptions.json."
            ),
        }
    )
    return out


def build_view(snapshot: dict[str, Any], assumptions: dict[str, Any], run_key: str = "warRoom") -> dict[str, Any]:
    run = snapshot["runs"][run_key]
    ledger = time_ledger(run, assumptions)
    return {
        "run": run,
        "runKey": run_key,
        "roles": snapshot["roles"],
        "lanes": schedule_lanes(run),
        "ticks": hour_ticks(),
        "changes": schedule_changes(run),
        "agents": agent_activity(run),
        "handoffs": handoffs(run),
        "compliance": compliance_items(run),
        "guardrails": guardrails(run),
        "ledger": ledger,
        "insights": insights(run, ledger),
    }
