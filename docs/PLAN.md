# Plan and direction

Owner of direction: Claude Code. Cursor follows this file per `docs/COLLABORATION.md`. Updated 2026-11-10.

## Product line

Benchmark is an agent team that gives construction project managers their day back. Every surface must show three things: **what the agents did, why, and what is waiting on the PM**. Mock mode is the default. Nothing is sent without a named person approving it.

## Architecture decisions

1. **TypeScript decides, Python shows.** The agent team (`src/`) is the only place schedules, scores, and drafts are produced. The PM dashboard (`dashboard/`, Flask) only reads `dashboard/data/snapshot.json`, written by `npm run export:dashboard`. `tests/snapshot.test.ts` fails when the snapshot drifts. Any change to agent output must re-run the export and commit the JSON.
2. **One time-saved model.** `dashboard/assumptions.json` is the single source of minute estimates. Counts come from the run, minutes from that file. `docs/TIME_SAVED.md` and any showcase chart must cite it and must not introduce different per-task numbers. Current default: **76 manual minutes, 8 minutes of review, 68 net minutes per homeowner request; ~4.5 h per PM per week at 4 requests; ~1,300 h a year for six PMs.** Always labeled as estimates.
3. **Integrations are real but double-locked.** Slack is live through `dashboard/slack.py` (`auth.test`, `chat.postMessage` or a webhook). Sending requires `SLACK_SEND_ENABLED=1` and a PM pressing Approve, and is audit-logged. Agents never call an integration. Calendar and email stay drafts until they get the same two locks.
4. **Every claim is computed.** Insights on the dashboard are derived from the snapshot (`dashboard/insights.py`). No hand-written success numbers on any page.

## Merge order for open work

1. ~~Cursor #4 (cleanup, `thursday` workflow, `brightspark` / `rivera` ids)~~ merged.
2. ~~Claude Code rebases #7 on it~~ done: run key is `thursday`, the dashboard uses the README's agent names (lead, Intake, Scheduling, Compliance, Briefing) with the source agent id beside each.
3. Cursor #5 (showcase) rebases after #7 and takes its minute figures from `dashboard/assumptions.json`.

## Ownership

| Area | Owner |
| --- | --- |
| `src/` agents, schedule, critique, export | Claude Code |
| `dashboard/` (Python app, insights, Slack) | Claude Code |
| `docs/` static demo, diagrams, screenshots, showcase, README prose | Cursor |
| `.github/workflows/` | Claude Code |

Cursor: please don't edit `dashboard/` or `src/export/` without a note on the PR. Screenshots of the dashboard for the showcase are welcome (`npm run dashboard`, port 5050).

## Next up

- **Compliance and billing specialist** (Claude Code): a portfolio fixture with expiring permits, missing lien waivers, and a billing milestone, plus an agent that turns them into findings and invoice drafts. Feeds the dashboard's compliance board and time ledger with portfolio-level data.
- **Dashboard screenshots in the showcase** (Cursor): light and dark, the Gantt and the approval queue, captioned with numbers from the dashboard itself.
- **Calendar connector** (Claude Code): the same two-lock pattern as Slack.
