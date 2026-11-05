import { describeConflicts } from "../schedule/plan.js";
import { finding, handoff, record } from "../memory/state.js";
import type { RunState, Toolkit } from "../types.js";

export async function runIntake(state: RunState, tools: Toolkit): Promise<void> {
  const events = tools.listEvents();
  const inbox = tools.listInbox();
  const conflicts = describeConflicts(events);
  const urgent = inbox.filter((mail) => mail.urgent);

  for (const conflict of conflicts) {
    finding(state, {
      source: "intake",
      level: "critical",
      code: "OVERLAP",
      summary: conflict,
    });
  }
  for (const mail of urgent) {
    finding(state, {
      source: "intake",
      level: "critical",
      code: "URGENT_MAIL",
      summary: `${mail.at} ${mail.from}: ${mail.subject}`,
    });
  }
  const protectedBlocks = events.filter((event) => event.protected).map((event) => event.title);
  finding(state, {
    source: "intake",
    level: "info",
    code: "PROTECTED",
    summary: `Protected: ${protectedBlocks.join(", ")}.`,
  });

  const conflictLine = conflicts.length > 0 ? conflicts.join(" ") : "No overlaps on the calendar yet.";
  const mailLine =
    urgent.length > 0
      ? urgent.map((mail) => `${mail.from} wrote at ${mail.at}: ${mail.subject}`).join(" ")
      : "The inbox does not change the shape of the day.";

  record(state, {
    agent: "intake",
    title: "Read the day",
    detail: `${conflictLine}\n${mailLine}`,
    handoff: handoff(
      "researcher",
      urgent.length > 0 ? "An escalation needs account context before anyone moves a meeting." : "Name the accounts already on the day.",
    ),
  });
}
