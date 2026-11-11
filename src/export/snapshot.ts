import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { diffSweeps } from "../agents/changes.js";
import { sweepPortfolio } from "../agents/coordinator.js";
import { ROLES } from "../agents/roles.js";
import { PORTFOLIO, PORTFOLIO_YESTERDAY } from "../fixtures/portfolio.js";
import { runWorkflow } from "../orchestrator/supervisor.js";
import { resolveModel } from "../providers/model.js";
import { range } from "../time.js";
import type { CalendarEvent, Plan, RunState } from "../types.js";

/**
 * Everything the Python dashboard needs, in one JSON file.
 * The dashboard never re-plans the day. It reads what the agents decided.
 */
export function snapshotRun(state: RunState) {
  return {
    runId: state.runId,
    workflow: state.workflow,
    status: state.status,
    model: state.modelName,
    goal: state.goal,
    dateLabel: state.dateLabel,
    persona: state.persona,
    role: state.role,
    priorities: state.priorities,
    calendarBefore: state.events.map(event),
    demands: state.demands,
    inbox: state.inbox,
    accounts: state.accounts,
    findings: state.findings,
    research: state.research,
    attempts: state.attempts.map(plan),
    critiques: state.critiques,
    approvedPlan: state.plan ? plan(state.plan) : null,
    actions: state.actions,
    brief: state.brief ?? null,
    trace: state.trace,
  };
}

function event(e: CalendarEvent) {
  return { ...e, when: range(e.start, e.end) };
}

function plan(p: Plan) {
  return {
    strategy: p.strategy,
    notes: p.notes,
    unplaced: p.unplaced,
    blocks: p.blocks.map((b) => ({ ...b, when: range(b.start, b.end) })),
  };
}

/** Today's sweep plus what changed since yesterday's. Live, yesterday's sweep comes from the last export. */
export function portfolioSnapshot() {
  const sweep = sweepPortfolio(PORTFOLIO);
  return { data: PORTFOLIO, sweep, changes: diffSweeps(sweepPortfolio(PORTFOLIO_YESTERDAY), sweep) };
}

export async function buildSnapshot() {
  const model = resolveModel(false);
  const [thursday, morning] = await Promise.all([
    runWorkflow({ workflow: "thursday", model }),
    runWorkflow({ workflow: "morning", model }),
  ]);
  return {
    schema: 1,
    generatedBy: "src/export/snapshot.ts",
    roles: ROLES,
    runs: { thursday: snapshotRun(thursday), morning: snapshotRun(morning) },
    portfolio: portfolioSnapshot(),
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const out = resolve(process.argv[2] ?? "dashboard/data/snapshot.json");
  buildSnapshot()
    .then((snapshot) => {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
      process.stdout.write(`Wrote ${out}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
