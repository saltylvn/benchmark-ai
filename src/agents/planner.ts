import { chooseStrategy, planSchedule } from "../schedule/plan.js";
import { handoff, record } from "../memory/state.js";
import { range } from "../time.js";
import type { RunState } from "../types.js";

export async function runPlanner(state: RunState): Promise<void> {
  const previous = state.critiques.at(-1);
  const strategy = chooseStrategy({
    hasTriedClientFirst: state.attempts.some((plan) => plan.strategy === "client-first"),
    previousFailures: previous && !previous.approved ? previous.failures.map((failure) => failure.code) : [],
  });
  const plan = planSchedule({
    events: state.events,
    demands: state.demands,
    strategy,
  });
  state.attempts.push(plan);
  state.plan = plan;

  const focus = plan.blocks.find((block) => block.kind === "focus");
  const created = plan.blocks.filter((block) => !state.events.some((event) => event.id === block.id));
  const detail = [
    focus ? `Focus at ${range(focus.start, focus.end)}.` : "No focus block in this proposal.",
    focus?.reason ?? "",
    created.length > 0
      ? `New blocks: ${created.map((block) => `${block.title} ${range(block.start, block.end)}`).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  record(state, {
    agent: "planner",
    title: `Revision ${state.revision} · ${label(strategy)}`,
    detail,
    handoff: handoff("critic", "Score this proposal. Do not soften it on the way."),
  });
}

function label(strategy: RunState["attempts"][number]["strategy"]): string {
  return strategy === "client-first" ? "client-first" : "protect-focus";
}
