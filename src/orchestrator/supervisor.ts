import { runBriefWriter } from "../agents/briefWriter.js";
import { runCritic } from "../agents/critic.js";
import { runExecutor } from "../agents/executor.js";
import { runIntake } from "../agents/intake.js";
import { runPlanner } from "../agents/planner.js";
import { runResearcher } from "../agents/researcher.js";
import { ACCOUNTS, DAY, ESCALATION, EVENTS, MERIDIAN_DEMAND, PRIORITIES } from "../fixtures/tuesday.js";
import { handoff, record } from "../memory/state.js";
import { createToolkit } from "../tools/toolkit.js";
import type { ProseModel, RunState } from "../types.js";

const MAX_REVISIONS = 3;

/**
 * One supervisor, one blackboard, specialists that do not call each other.
 * The supervisor is the only router. A rejected critique is a handoff back
 * to the planner with the failure code attached to shared state.
 */
export async function runWorkflow(input: {
  workflow: RunState["workflow"];
  model: ProseModel;
}): Promise<RunState> {
  const state = createState(input.workflow, input.model.name);
  const tools = createToolkit(state);

  record(state, {
    agent: "supervisor",
    title: input.workflow === "war-room" ? "War room is open" : "Morning planning is open",
    detail: state.goal,
    advance: 2,
    handoff: handoff("intake", "Start from the calendar and the inbox, not from a hunch."),
  });

  await runIntake(state, tools);
  await runResearcher(state, tools);

  for (let revision = 1; revision <= MAX_REVISIONS; revision += 1) {
    state.revision = revision;
    await runPlanner(state);
    await runCritic(state);
    const latest = state.critiques.at(-1);
    if (latest?.approved) break;
  }

  const approved = state.critiques.at(-1)?.approved === true;
  if (!approved) {
    state.status = "needs_human";
    record(state, {
      agent: "supervisor",
      title: "Stopped for a person",
      detail: `No approvable plan after ${MAX_REVISIONS} revisions.`,
    });
    return state;
  }

  state.status = "approved";
  await runExecutor(state, input.model);
  await runBriefWriter(state, input.model);
  record(state, {
    agent: "supervisor",
    title: "Closed",
    detail: "Approved plan, drafts in memory, brief written. Nothing was sent.",
    advance: 4,
  });
  return state;
}

function createState(workflow: RunState["workflow"], modelName: string): RunState {
  const warRoom = workflow === "war-room";
  return {
    runId: warRoom ? "tuesday-war-room" : "tuesday-morning",
    workflow,
    goal: warRoom
      ? "An escalation landed at 08:47. Give Meridian a morning call before the 13:00 review, keep a real focus block, and do not delete the walk or move the 1:1."
      : "Plan Tuesday before the day starts. The calendar is already double-booked. Protect focus, keep the walk, and move only what is movable.",
    dateLabel: DAY.dateLabel,
    persona: DAY.persona,
    role: DAY.role,
    clock: warRoom ? DAY.now : 8 * 60 + 5,
    traceSeconds: 0,
    events: EVENTS.map((event) => ({ ...event })),
    demands: warRoom ? [{ ...MERIDIAN_DEMAND }] : [],
    accounts: ACCOUNTS.map((account) => ({ ...account, cases: account.cases.map((item) => ({ ...item })) })),
    inbox: warRoom ? [{ ...ESCALATION }] : [],
    priorities: [...PRIORITIES],
    findings: [],
    research: [],
    critiques: [],
    actions: [],
    attempts: [],
    trace: [],
    revision: 0,
    status: "running",
    modelName,
  };
}
