import { clockLabel } from "../time.js";
import type { AgentId, Finding, RunState, TraceEvent } from "../types.js";

export function record(
  state: RunState,
  event: Omit<TraceEvent, "at"> & { advance?: number },
): TraceEvent {
  state.traceSeconds += event.advance ?? 8;
  const stamped: TraceEvent = {
    at: clockLabel(state.clock, state.traceSeconds),
    agent: event.agent,
    title: event.title,
    detail: event.detail,
    handoff: event.handoff,
  };
  state.trace.push(stamped);
  return stamped;
}

export function finding(state: RunState, input: Omit<Finding, "id">): Finding {
  const next: Finding = { ...input, id: `${input.code}-${state.findings.length + 1}` };
  state.findings.push(next);
  return next;
}

export function handoff(to: AgentId, reason: string): NonNullable<TraceEvent["handoff"]> {
  return { to, reason };
}
