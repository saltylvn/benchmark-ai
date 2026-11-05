import { buildActions, missingStatusDrafts } from "../schedule/actions.js";
import { finding, handoff, record } from "../memory/state.js";
import type { ProseModel, RunState } from "../types.js";

export async function runExecutor(state: RunState, model: ProseModel): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const actions = buildActions({
    events: state.events,
    plan,
    demands: state.demands,
    accounts: state.accounts,
    persona: state.persona,
  });

  for (const action of actions) {
    if (action.type !== "email.draft" && action.type !== "slack.draft") continue;
    const facts = factSheet(state);
    if (action.type === "email.draft") {
      action.body = await model.polish({ kind: "email", draft: action.body, facts });
    } else {
      action.text = await model.polish({ kind: "slack", draft: action.text, facts });
    }
  }

  state.actions = actions;
  const gaps = missingStatusDrafts(state.demands, actions);
  for (const gap of gaps) {
    finding(state, { source: "executor", level: "warn", code: "DRAFT_GAP", summary: gap });
  }

  const calendarCount = actions.filter((action) => action.type.startsWith("calendar.")).length;
  const proseCount = actions.length - calendarCount;
  record(state, {
    agent: "executor",
    title: `${actions.length} drafts · nothing sent`,
    detail: [
      `${calendarCount} calendar ${calendarCount === 1 ? "change" : "changes"}, ${proseCount} message ${proseCount === 1 ? "draft" : "drafts"}.`,
      gaps.length > 0 ? gaps.join(" ") : "Every deadline that needed a written status has a draft.",
      "The draft sink is in memory. There is no live calendar, Slack, or mail call on this path.",
    ].join(" "),
    handoff: handoff("brief", "Write the morning brief off the approved plan."),
  });
}

function factSheet(state: RunState): string[] {
  const lines = [`Date: ${state.dateLabel}`, `Persona: ${state.persona}`];
  for (const block of state.plan?.blocks ?? []) {
    lines.push(`${block.title} ${block.start}-${block.end}`);
  }
  for (const account of state.accounts) {
    for (const item of account.cases) lines.push(`${item.id} ${item.title}`);
  }
  return lines;
}
