"""Team views: the Today queue, the jobs board and timeline, workload, and messages.

Everything here reads ``snapshot["portfolio"]``, which the TypeScript Coordinator
writes. Nothing is re-decided in Python; it is arranged for a person to act on.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

STAGES = [
    ("lead", "Lead"),
    ("quote", "Quote"),
    ("scheduled", "Scheduled"),
    ("in-progress", "In progress"),
    ("closeout", "Closeout"),
]
STATUS_LABEL = {"on-track": "On track", "at-risk": "At risk", "behind": "Behind"}
KIND_LABEL = {
    "insurance": "Insurance",
    "permit": "Permit",
    "inspection": "Inspection",
    "lien-waiver": "Lien waiver",
    "invoice": "Invoice",
    "client-update": "Client update",
    "double-booking": "Double-booked",
    "late-milestone": "Late",
    "quote-due": "Quote due",
    "workload": "Workload",
}
DRAFT_ACTION = {
    "slack": "Approve & send to Slack",
    "email": "Approve email",
    "invoice": "Approve invoice",
    "reassign": "Approve handoff",
}
DRAFT_CHANNEL = {"slack": "Slack", "email": "Email", "invoice": "Invoice", "reassign": "Team change"}


def _d(iso: str) -> date:
    return date.fromisoformat(iso)


def short(iso: str | None) -> str:
    if not iso:
        return ""
    d = _d(iso)
    return f"{d.strftime('%a')}, {d.strftime('%b')} {d.day}"


def people(p: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {x["id"]: x for x in p["data"]["people"]}


def first(name: str) -> str:
    return name.split(" ")[0]


# ---------------------------------------------------------------------------
# Today: one queue of decisions, most urgent first


def today_queue(p: dict[str, Any], minutes: dict[str, float], run: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    sweep, who = p["sweep"], people(p)
    today = _d(sweep["today"])
    risks = {r["id"]: r for r in sweep["risks"]}
    items: list[dict[str, Any]] = []

    if run and run.get("status") == "approved":
        moves = sum(1 for a in run["actions"] if a["type"].startswith("calendar"))
        items.append(
            {
                "id": "day-maria",
                "kind": "day",
                "kindLabel": "Day rewrite",
                "level": "blocked",
                "owner": "maria",
                "ownerName": who["maria"]["name"],
                "jobId": "J-1042",
                "title": run["brief"]["headline"] if run.get("brief") else "Day rewritten",
                "why": f"Sam Rivera asked for a morning call at 08:47. {moves} calendar moves, an email, and a Slack note are ready. The checklist rejected the first plan.",
                "due": sweep["today"],
                "dueLabel": "Today",
                "channel": "Calendar",
                "to": "Maria's calendar",
                "subject": "Approve the rewritten day",
                "body": "\n".join(run["brief"]["outcomes"]) if run.get("brief") else "",
                "action": "Approve day",
                "minutes": 0,
                "link": "#hood",
            }
        )

    for d in sweep["drafts"]:
        r = risks.get(d.get("riskId"), {})
        due = r.get("due")
        days = (_d(due) - today).days if due else None
        items.append(
            {
                "id": d["id"],
                "kind": d["kind"],
                "kindLabel": KIND_LABEL.get(r.get("kind", ""), DRAFT_CHANNEL[d["kind"]]),
                "level": r.get("level", "watch"),
                "owner": d["owner"],
                "ownerName": who[d["owner"]]["name"],
                "jobId": d.get("jobId"),
                "title": r.get("title", d["subject"]),
                "why": r.get("detail", ""),
                "due": due,
                "dueLabel": "Overdue" if days is not None and days < 0 else "Today" if days == 0 else "Tomorrow" if days == 1 else short(due),
                "channel": DRAFT_CHANNEL[d["kind"]],
                "to": d["to"],
                "subject": d["subject"],
                "body": d["body"],
                "amount": d.get("amount"),
                "action": DRAFT_ACTION[d["kind"]],
                "minutes": minutes.get(d["task"], 0),
            }
        )

    # Risks with nothing to send still need a person: list them as heads-ups.
    answered = {d.get("riskId") for d in sweep["drafts"]}
    for r in sweep["risks"]:
        if r["id"] in answered:
            continue
        due = r.get("due")
        days = (_d(due) - today).days if due else None
        items.append(
            {
                "id": r["id"],
                "kind": "heads-up",
                "kindLabel": KIND_LABEL.get(r["kind"], r["kind"]),
                "level": r["level"],
                "owner": r["owner"],
                "ownerName": who[r["owner"]]["name"],
                "jobId": r.get("jobId"),
                "title": r["title"],
                "why": r["detail"],
                "due": due,
                "dueLabel": "Overdue" if days is not None and days < 0 else "Today" if days == 0 else "Tomorrow" if days == 1 else short(due),
                "channel": None,
                "action": "Mark handled",
                "minutes": 0,
            }
        )

    rank = {"blocked": 0, "watch": 1}
    return sorted(items, key=lambda i: (rank.get(i["level"], 2), i["due"] or "9999", i["kind"] == "heads-up"))


# ---------------------------------------------------------------------------
# Jobs: status board and timeline


def job_cards(p: dict[str, Any]) -> list[dict[str, Any]]:
    who = people(p)
    data = {j["id"]: j for j in p["data"]["jobs"]}
    risks_by_job: dict[str, list[dict[str, Any]]] = {}
    for r in p["sweep"]["risks"]:
        if r.get("jobId"):
            risks_by_job.setdefault(r["jobId"], []).append(r)
    cards = []
    for s in p["sweep"]["statuses"]:
        j = data[s["jobId"]]
        cards.append(
            {
                **s,
                "statusLabel": STATUS_LABEL[s["status"]],
                "pmName": who[s["pm"]]["name"],
                "client": j["client"],
                "address": j["address"],
                "contract": j["contract"],
                "channel": j["slackChannel"],
                "nextLabel": f"{s['nextMilestone']['name']} · {short(s['nextMilestone']['planned'])}" if s.get("nextMilestone") else "All milestones done",
                "risks": [{"label": KIND_LABEL.get(r["kind"], r["kind"]), "level": r["level"], "title": r["title"]} for r in risks_by_job.get(s["jobId"], [])],
            }
        )
    return cards


def board(p: dict[str, Any]) -> list[dict[str, Any]]:
    cards = job_cards(p)
    return [{"id": sid, "label": label, "jobs": [c for c in cards if c["stage"] == sid]} for sid, label in STAGES]


def timeline(p: dict[str, Any]) -> dict[str, Any]:
    """Every job's milestones on one week grid, with a today line."""
    today = _d(p["sweep"]["today"])
    dates = [_d(m["planned"]) for s in p["sweep"]["statuses"] for m in s["milestones"]]
    dates += [_d(m["done"]) for s in p["sweep"]["statuses"] for m in s["milestones"] if m.get("done")]
    # Show four weeks back to seven weeks ahead, clipped to the data, starting on a Monday.
    start = max(min(dates), today - timedelta(days=28))
    start -= timedelta(days=start.weekday())
    end = min(max(dates), today + timedelta(days=56))
    end += timedelta(days=6 - end.weekday())
    span = (end - start).days or 1

    def x(d: date) -> float:
        return round(max(0, min(span, (d - start).days)) / span * 100, 3)

    weeks = []
    cur = start
    while cur <= end:
        weeks.append({"label": f"{cur.strftime('%b')} {cur.day}", "left": x(cur)})
        cur += timedelta(days=7)

    rows = []
    for c in job_cards(p):
        ms = []
        for m in c["milestones"]:
            ms.append(
                {
                    "name": m["name"],
                    "left": x(_d(m["planned"])),
                    "state": m["state"],
                    "when": short(m["planned"]),
                    "done": short(m.get("done")),
                    "clipped": _d(m["planned"]) < start or _d(m["planned"]) > end,
                }
            )
        visible = [m for m in ms if not m["clipped"]]
        bar_from = visible[0]["left"] if visible else 0
        bar_to = visible[-1]["left"] if visible else 0
        rows.append({**c, "points": visible, "barLeft": bar_from, "barWidth": max(bar_to - bar_from, 0.6)})
    order = {"behind": 0, "at-risk": 1, "on-track": 2}
    rows.sort(key=lambda r: (order[r["status"]], r["jobId"]))
    return {"weeks": weeks, "today": x(today), "todayLabel": short(p["sweep"]["today"]), "rows": rows}


def lookahead(p: dict[str, Any], days: int = 14) -> list[dict[str, Any]]:
    """Everything on the team's calendar for the next two weeks, by day."""
    data = p["data"]
    today = _d(p["sweep"]["today"])
    jobs = {j["id"]: j for j in data["jobs"]}
    subs = {s["id"]: s for s in data["subs"]}
    who = people(p)
    clash = {}
    for b in data["bookings"]:
        clash[(b["subId"], b["date"])] = clash.get((b["subId"], b["date"]), 0) + 1
    events: list[dict[str, Any]] = []

    def add(day: str, kind: str, title: str, job_id: str, note: str = "", flag: str | None = None) -> None:
        d = _d(day)
        if 0 <= (d - today).days <= days:
            j = jobs[job_id]
            events.append({"date": day, "kind": kind, "title": title, "jobId": job_id, "job": j["name"], "owner": j["pm"], "ownerName": who[j["pm"]]["name"], "note": note, "flag": flag})

    for j in data["jobs"]:
        for m in j["milestones"]:
            if not m.get("done"):
                add(m["planned"], "Milestone", m["name"], j["id"])
        if j.get("inspection"):
            add(j["inspection"]["date"], "Inspection", j["inspection"]["name"], j["id"], j["inspection"].get("who") or "Nobody assigned yet", None if j["inspection"].get("who") else "watch")
        if j.get("quoteDue"):
            add(j["quoteDue"], "Quote due", f"Quote to {j['client']}", j["id"])
    for b in data["bookings"]:
        sub = subs[b["subId"]]
        flag = None
        note = sub["name"]
        if clash[(b["subId"], b["date"])] > 1:
            flag, note = "blocked", f"{sub['name']} is booked on two jobs"
        elif _d(sub["coiExpires"]) < _d(b["date"]):
            flag, note = "blocked", f"{sub['name']} insurance {'expired' if _d(sub['coiExpires']) < today else 'lapses first'}"
        add(b["date"], "Crew", b["task"], b["jobId"], note, flag)

    out = []
    for i in range(days + 1):
        d = today + timedelta(days=i)
        todays = sorted((e for e in events if e["date"] == d.isoformat()), key=lambda e: (e["flag"] is None, e["kind"]))
        if todays:
            label = "Today" if i == 0 else "Tomorrow" if i == 1 else short(d.isoformat())
            out.append({"date": d.isoformat(), "label": label, "weekend": d.weekday() >= 5, "events": todays})
    return out


def status_counts(p: dict[str, Any]) -> dict[str, int]:
    out = {"on-track": 0, "at-risk": 0, "behind": 0}
    for s in p["sweep"]["statuses"]:
        out[s["status"]] += 1
    return out


# ---------------------------------------------------------------------------
# Team


def team(p: dict[str, Any]) -> list[dict[str, Any]]:
    data = {j["id"]: j for j in p["data"]["jobs"]}
    statuses = {s["jobId"]: s for s in p["sweep"]["statuses"]}
    out = []
    for w in p["sweep"]["workload"]:
        share = w["hours"] / w["capacity"] if w["capacity"] else 0
        out.append(
            {
                **w,
                "first": first(w["name"]),
                "share": round(min(share, 1.2) * 100 / 1.2, 2),  # bar scale tops out at 120% of capacity
                "capacityMark": round(100 / 1.2, 2),
                "percent": round(share * 100),
                "jobCards": [
                    {"id": jid, "name": data[jid]["name"], "status": statuses[jid]["status"], "statusLabel": STATUS_LABEL[statuses[jid]["status"]], "hours": data[jid]["hoursThisWeek"]}
                    for jid in w["jobs"]
                ],
                "blocked": sum(1 for r in p["sweep"]["risks"] if r["owner"] == w["personId"] and r["level"] == "blocked"),
            }
        )
    return out


def subs(p: dict[str, Any]) -> list[dict[str, Any]]:
    today = _d(p["sweep"]["today"])
    out = []
    for s in p["data"]["subs"]:
        bookings = [b for b in p["data"]["bookings"] if b["subId"] == s["id"] and _d(b["date"]) >= today]
        left = (_d(s["coiExpires"]) - today).days
        lapses_first = bool(bookings) and _d(s["coiExpires"]) < _d(bookings[0]["date"])
        level = "blocked" if bookings and (left < 0 or lapses_first) else "watch" if left <= 14 else "ok"
        out.append(
            {
                **s,
                "coiLabel": f"expired {short(s['coiExpires'])}" if left < 0 else f"ends {short(s['coiExpires'])}",
                "level": level,
                "next": f"{bookings[0]['jobId']} · {bookings[0]['task']} · {short(bookings[0]['date'])}" if bookings else "No upcoming work",
            }
        )
    rank = {"blocked": 0, "watch": 1, "ok": 2}
    return sorted(out, key=lambda s: rank[s["level"]])


# ---------------------------------------------------------------------------
# Messages and time


def messages(queue: list[dict[str, Any]], digest: str) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in queue:
        if item.get("channel") and item["kind"] != "day":
            groups.setdefault(item["channel"], []).append(item)
    order = ["Slack", "Email", "Invoice", "Team change"]
    out = [
        {
            "channel": "Morning brief",
            "entries": [
                {
                    "id": "digest",
                    "kind": "digest",
                    "title": "Team status digest",
                    "to": "#team",
                    "subject": "Morning status",
                    "body": digest,
                    "action": "Approve & send to Slack",
                    "ownerName": "Coordinator",
                    "owner": "all",
                    "level": "watch",
                }
            ],
        }
    ]
    out += [{"channel": c, "entries": groups[c]} for c in order if c in groups]
    return out


def team_ledger(p: dict[str, Any], assumptions: dict[str, Any]) -> dict[str, Any]:
    m = assumptions["teamManualMinutes"]
    drafts = p["sweep"]["drafts"]
    lines = [{"task": "Check every job, sub, and PM by hand", "count": 1, "minutesEach": m["dailySweep"]}]
    labels = {
        "subNudge": "Chase a sub for insurance",
        "permitCheck": "Write a permit extension request",
        "lienChase": "Chase a lien waiver",
        "invoiceDraft": "Build a progress invoice",
        "clientUpdate": "Write a client update",
        "conflictResolution": "Sort out a double-booked crew",
        "reassign": "Rebalance PM workload",
    }
    for task, label in labels.items():
        n = sum(1 for d in drafts if d["task"] == task)
        if n:
            lines.append({"task": label, "count": n, "minutesEach": m[task]})
    lines.append({"task": "Write the team status update", "count": 1, "minutesEach": m["statusDigest"]})
    for line in lines:
        line["minutes"] = line["count"] * line["minutesEach"]
    top = max(l["minutes"] for l in lines) or 1
    for line in lines:
        line["bar"] = round(line["minutes"] / top * 100, 1)
    manual = sum(l["minutes"] for l in lines)
    review = (len(drafts) + 1) * assumptions["teamReviewMinutesPerDraft"]
    net = manual - review
    week = net * assumptions["workDaysPerWeek"]
    return {
        "lines": lines,
        "manualMinutes": manual,
        "reviewMinutes": review,
        "netMinutes": net,
        "weekHours": round(week / 60, 1),
        "yearHours": round(week * assumptions["workWeeksPerYear"] / 60),
    }


def found_by_kind(queue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}
    for i in queue:
        key = i["kindLabel"]
        row = counts.setdefault(key, {"label": key, "count": 0, "blocked": 0})
        row["count"] += 1
        row["blocked"] += i["level"] == "blocked"
    return sorted(counts.values(), key=lambda r: (-r["blocked"], -r["count"], r["label"]))


def build_team_view(snapshot: dict[str, Any], assumptions: dict[str, Any]) -> dict[str, Any]:
    p = snapshot["portfolio"]
    minutes = {**assumptions["teamManualMinutes"]}
    queue = today_queue(p, minutes, snapshot["runs"].get("thursday"))
    who = people(p)
    return {
        "company": p["data"]["company"],
        "today": p["sweep"]["today"],
        "todayLabel": short(p["sweep"]["today"]),
        "queue": queue,
        "blockedCount": sum(1 for i in queue if i["level"] == "blocked"),
        "found": found_by_kind(queue),
        "owners": [{"id": x["id"], "name": x["name"], "first": first(x["name"])} for x in p["data"]["people"] if x["role"] == "Project manager"],
        "board": board(p),
        "lookahead": lookahead(p),
        "timeline": timeline(p),
        "counts": status_counts(p),
        "jobsTotal": len(p["sweep"]["statuses"]),
        "team": team(p),
        "subs": subs(p),
        "messages": messages(queue, p["sweep"]["digest"]),
        "digest": p["sweep"]["digest"],
        "steps": p["sweep"]["steps"],
        "ledger": team_ledger(p, assumptions),
        "people": who,
    }
