import { critiquePlan } from "../schedule/critique.js";
import { handoff, record } from "../memory/state.js";
import type { RunState } from "../types.js";

export async function runCritic(state: RunState): Promise<void> {
  const plan = state.plan;
  if (!plan) {
    record(state, {
      agent: "critic",
      title: "Nothing to score",
      detail: "The planner has not proposed a day.",
      handoff: handoff("planner", "A critique needs a proposal."),
    });
    return;
  }

  const critique = critiquePlan({
    plan,
    events: state.events,
    demands: state.demands,
    revision: state.revision,
  });
  state.critiques.push(critique);

  const failure = critique.failures[0];
  if (!critique.approved) {
    record(state, {
      agent: "critic",
      title: `${critique.score}/100 · rejected`,
      detail: [
        failure ? `${failure.code}. ${failure.detail}` : "Rejected.",
        `Still held: ${critique.passed.slice(0, 4).join("; ")}.`,
      ].join("\n"),
      handoff: handoff(
        "planner",
        failure?.code === "FOCUS_BLOCK"
          ? "Switch to protect-focus. Reserve the morning before you place non-critical clients."
          : "Revise against the named failure. Do not start over from a blank page.",
      ),
    });
    return;
  }

  record(state, {
    agent: "critic",
    title: `${critique.score}/100 · approved`,
    detail: "Focus, the walk, lunch, the fixed meetings, and the deadline all hold.",
    handoff: handoff("executor", "Materialize drafts. Do not send them."),
  });
}
