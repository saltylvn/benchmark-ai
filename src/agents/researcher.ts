import { finding, handoff, record } from "../memory/state.js";
import type { Account, ResearchNote, RunState, Toolkit } from "../types.js";

export async function runResearcher(state: RunState, tools: Toolkit): Promise<void> {
  const urgentIds = new Set(
    tools
      .listInbox()
      .filter((mail) => mail.urgent && mail.accountId)
      .map((mail) => mail.accountId as string),
  );
  const accounts = tools.accountsOnCalendar().sort((a, b) => rank(a, urgentIds) - rank(b, urgentIds));

  for (const account of accounts) {
    const note = toNote(account, urgentIds.has(account.id));
    state.research.push(note);
    finding(state, {
      source: "researcher",
      level: urgentIds.has(account.id) ? "critical" : "info",
      code: "ACCOUNT",
      summary: note.headline,
    });
  }

  const lead = state.research[0];
  const rest = state.research.slice(1).map((note) => {
    const event = state.events.find((item) => item.accountId === note.accountId);
    const mobility = event?.flexibility === "fixed" ? "fixed window" : "movable";
    return `${note.name} (${mobility})`;
  });
  record(state, {
    agent: "researcher",
    title: lead ? lead.headline : "No accounts on this day",
    detail: lead
      ? [
          lead.bullets.map((bullet) => `· ${bullet}`).join("\n"),
          lead.questions.length > 0 ? `Ask first: ${lead.questions[0]}` : "",
          rest.length > 0 ? `Also today: ${rest.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "Nothing to look up.",
    handoff: handoff("planner", "The board has the constraints and the job facts. Propose a day."),
  });
}

function rank(account: Account, urgentIds: Set<string>): number {
  if (urgentIds.has(account.id)) return 0;
  if (account.tier === "strategic") return 1;
  if (account.cases.some((item) => item.priority === "P0" || item.priority === "P1")) return 2;
  return 3;
}

function toNote(account: Account, urgent: boolean): ResearchNote {
  const topCase = [...account.cases].sort((a, b) => a.priority.localeCompare(b.priority))[0];
  const headline = urgent
    ? `${account.name} · quote needed today · ${account.milestone ?? "no date yet"}`
    : `${account.name} · last touch ${account.lastTouch}`;
  const bullets = [
    topCase ? `${topCase.priority} ${topCase.id}: ${topCase.title} (${topCase.status}).` : "",
    `Last touch ${account.lastTouch}. ${account.lastTouchNote}`,
    ...account.facts.slice(0, urgent ? 3 : 1),
  ].filter(Boolean);
  return {
    accountId: account.id,
    name: account.name,
    headline,
    summary: account.summary,
    bullets,
    questions: urgent ? account.openQuestions : account.openQuestions.slice(0, 1),
    doNotPromise: account.doNotPromise,
  };
}
