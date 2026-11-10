# Plan and direction

Owner of direction: Claude Code. Cursor follows this file per `docs/COLLABORATION.md`. Updated 2026-11-10 (overnight build).

## Product line

Benchmark is an agent team that gives construction project managers their day back. Every surface must show three things: **what the agents did, why, and what is waiting on the PM**. Mock mode is the default. Nothing is sent without a named person approving it.

## Architecture decisions

1. **TypeScript decides, Python shows.** The agent team (`src/`) is the only place schedules, scores, and drafts are produced. The PM dashboard (`dashboard/`, Flask) only reads `dashboard/data/snapshot.json`, written by `npm run export:dashboard`. `tests/snapshot.test.ts` fails when the snapshot drifts. Any change to agent output must re-run the export and commit the JSON.
2. **One time-saved model.** `dashboard/assumptions.json` is the single source of minute estimates. Counts come from the run, minutes from that file. `docs/TIME_SAVED.md` and any showcase chart must cite it and must not introduce different per-task numbers. Current default: **76 manual minutes, 8 minutes of review, 68 net minutes per homeowner request; ~4.5 h per PM per week at 4 requests; ~1,300 h a year for six PMs.** Always labeled as estimates.
3. **Integrations are real but double-locked.** Slack is live through `dashboard/slack.py` (`auth.test`, `chat.postMessage` or a webhook). Sending requires `SLACK_SEND_ENABLED=1` and a PM pressing Approve, and is audit-logged. Agents never call an integration. Calendar and email stay drafts until they get the same two locks.
4. **Every claim is computed.** Insights on the dashboard are derived from the snapshot (`dashboard/insights.py`, `dashboard/portfolio.py`). No hand-written success numbers on any page.
5. **Two agent layers.** The Thursday supervisor (`src/orchestrator/supervisor.ts`) handles one request in depth. The **Coordinator** (`src/agents/coordinator.ts`) sweeps the whole team each morning: sub insurance, permits, inspections, lien waivers, unbilled milestones, quiet clients, double-booked crews, quotes due, late milestones, PM workload. Both are pure functions; both only draft.
6. **One decision queue.** Every draft and heads-up lands in **Today**, most urgent first. Approvals go through `POST /api/approve` and are recorded with the approver's name. The dashboard is five tabs: Today, Jobs, Team, Messages, Under the hood. New features fit one of those tabs or don't ship.
7. **The 8:00 brief is the only automatic post.** `dashboard/brief.py`, `BRIEF_AT=08:00`, internal team channel only. Everything client- or sub-facing waits for a person.
8. **Team time model.** `assumptions.json → teamManualMinutes` prices the Coordinator's work: currently ~172 manual minutes a day, 9 of review, ~163 net (≈13.6 h a week for four PMs). Estimates, always labeled.

## Merge order for open work

1. #9 installable site, then #10 team view (stacked on #9; GitHub retargets it to `main` once #9 merges).
2. Cursor's showcase work rebases after #10 and takes figures from the dashboard and `assumptions.json`.

## Ownership

| Area | Owner |
| --- | --- |
| `src/` agents, schedule, critique, export | Claude Code |
| `dashboard/` (Python app, insights, Slack) | Claude Code |
| `docs/` static demo, diagrams, screenshots, showcase, README prose | Cursor |
| `.github/workflows/` | Claude Code |

Cursor: please don't edit `dashboard/` or `src/export/` without a note on the PR. Screenshots of the dashboard for the showcase are welcome (`npm run dashboard`, port 5050).

## Next up

- **Showcase screenshots of the five tabs** (Cursor): Today (queue + found-this-morning chips), Jobs (board, look-ahead, timeline), Team (workload + handoff), Messages (the 8:00 brief). Light and dark, phone and desktop. `npm run dashboard`, then View the demo. Caption with numbers shown on the page.
- **Real data in** (Claude Code): read jobs, milestones, and subs from Procore (the OAuth login already exists) into the `Portfolio` shape, behind the same snapshot contract.
- **Calendar and email connectors** (Claude Code): Google Calendar / Microsoft Graph and Gmail / Outlook drafts with the same two locks as Slack.
- **Job history** (Claude Code): keep each day's sweep so the Jobs tab can show status over time and the brief can say what changed since yesterday.
- **Public demo host** (owner decision): publish `dashboard/dist/site` (from `npm run build:site`) to a public static host so the home-screen app works off Wi-Fi.
