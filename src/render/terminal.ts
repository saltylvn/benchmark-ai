import { ROLES } from "../agents/roles.js";
import { findOverlaps } from "../schedule/gaps.js";
import { durationLabel, range } from "../time.js";
import type { Action, CalendarEvent, Plan, PlanBlock, RunState } from "../types.js";

export interface RenderOptions {
  color: boolean;
}

const WIDTH = 78;

export function renderWarRoom(state: RunState, options: RenderOptions): string {
  const lines: string[] = [];
  lines.push(banner(state, options, "War room"));
  lines.push(section(options, "The ask"));
  const mail = state.inbox[0];
  if (mail) {
    lines.push(paint(options, "33", `${mail.at}  ${mail.from}`));
    lines.push(paint(options, "1", mail.subject));
    lines.push(indent(mail.body, 2));
  }
  lines.push("");
  lines.push(section(options, "Already true"));
  const clashes = findOverlaps(state.events);
  if (clashes.length === 0) lines.push("  The calendar was clean.");
  for (const clash of clashes) {
    lines.push(paint(options, "31", `  × ${clash.a.title} overlaps ${clash.b.title}.`));
  }
  lines.push("");
  lines.push(section(options, "Swarm"));
  for (const event of state.trace) {
    const tag = paint(options, event.agent === "critic" ? "35" : "36", event.agent.toUpperCase().padEnd(10));
    lines.push(`${paint(options, "2", event.at)}  ${tag}  ${event.title}`);
    lines.push(indent(event.detail, 14));
    if (event.handoff) {
      lines.push(
        paint(options, "2", `${"".padStart(14)}→ ${event.handoff.to}  ${event.handoff.reason}`),
      );
    }
    lines.push("");
  }
  lines.push(section(options, "The rewrite"));
  lines.push(diffBlock(state, options));
  if (state.brief) {
    lines.push(section(options, "Morning brief"));
    lines.push(paint(options, "1", `  ${state.brief.headline}`));
    lines.push("");
    lines.push(paint(options, "2", "  If you only do three things"));
    state.brief.outcomes.forEach((outcome, index) => {
      lines.push(`  ${index + 1}. ${wrap(outcome, 72, 5)}`);
    });
    lines.push("");
    if (state.brief.callCard) {
      const card = state.brief.callCard;
      lines.push(paint(options, "1", `  Call card  ·  ${card.account}  ·  ${card.when}`));
      lines.push(`  ${card.whyNow}`);
      lines.push(paint(options, "2", "  What we know"));
      for (const item of card.knows) lines.push(`    · ${item}`);
      lines.push(paint(options, "2", "  Ask"));
      for (const item of card.questions) lines.push(`    · ${item}`);
      lines.push(paint(options, "2", "  Do not promise"));
      for (const item of card.doNotPromise) lines.push(`    · ${item}`);
      lines.push(`  Leave with: ${card.success}`);
      lines.push("");
    }
    lines.push(paint(options, "2", "  Watch"));
    for (const item of state.brief.watchouts) lines.push(`    · ${item}`);
    lines.push("");
  }
  lines.push(section(options, "Drafts  ·  not sent"));
  lines.push(renderActions(state.actions, options));
  lines.push(footer(state));
  return lines.join("\n");
}

export function renderPlan(state: RunState, options: RenderOptions): string {
  const lines: string[] = [];
  lines.push(banner(state, options, "Day plan"));
  lines.push(state.goal);
  lines.push("");
  lines.push(section(options, "Priorities"));
  for (const priority of state.priorities) lines.push(`  · ${priority}`);
  lines.push("");
  lines.push(section(options, "Conflict"));
  for (const clash of findOverlaps(state.events)) {
    lines.push(paint(options, "31", `  × ${clash.a.title} (${range(clash.a.start, clash.a.end)})`));
    lines.push(paint(options, "31", `    overlaps ${clash.b.title} (${range(clash.b.start, clash.b.end)})`));
  }
  lines.push("");
  lines.push(attemptsView(state, options));
  lines.push(section(options, "Proposed day"));
  lines.push(diffBlock(state, options));
  lines.push(footer(state));
  return lines.join("\n");
}

export function renderBrief(state: RunState, options: RenderOptions): string {
  const lines: string[] = [];
  lines.push(banner(state, options, "Morning brief"));
  if (!state.brief) {
    lines.push("No brief. The plan was not approved.");
    return lines.join("\n");
  }
  lines.push(paint(options, "1", state.brief.headline));
  lines.push("");
  lines.push(section(options, "Three outcomes"));
  state.brief.outcomes.forEach((outcome, index) => {
    lines.push(`  ${index + 1}. ${wrap(outcome, 72, 5)}`);
  });
  lines.push("");
  lines.push(section(options, "The day"));
  for (const row of state.brief.schedule) {
    const note = row.note === "held" ? paint(options, "2", "held") : paint(options, "33", row.note);
    lines.push(`  ${row.time.padEnd(13)}  ${row.title.padEnd(42)}  ${note}`);
  }
  lines.push("");
  lines.push(section(options, "Watch"));
  for (const item of state.brief.watchouts) lines.push(`  · ${item}`);
  lines.push("");
  lines.push(footer(state));
  return lines.join("\n");
}

export function renderTraceJson(state: RunState): string {
  return JSON.stringify(
    {
      runId: state.runId,
      workflow: state.workflow,
      status: state.status,
      model: state.modelName,
      roles: ROLES,
      goal: state.goal,
      revisions: state.critiques.map((critique) => ({
        revision: critique.revision,
        strategy: critique.strategy,
        approved: critique.approved,
        score: critique.score,
        failures: critique.failures,
      })),
      trace: state.trace,
      schedule: (state.plan?.blocks ?? []).map((block) => ({
        id: block.id,
        title: block.title,
        kind: block.kind,
        when: range(block.start, block.end),
        reason: block.reason,
      })),
      actions: state.actions,
      brief: state.brief ?? null,
    },
    null,
    2,
  );
}

function banner(state: RunState, options: RenderOptions, title: string): string {
  const rule = "─".repeat(WIDTH);
  return [
    paint(options, "2", rule),
    `${paint(options, "1", "ATLAS")}  ${title}`,
    `${state.dateLabel}  ·  ${state.persona}, ${state.role}`,
    paint(options, "2", `mode ${state.modelName}  ·  status ${state.status}  ·  nothing is sent from this demo`),
    paint(options, "2", rule),
    "",
  ].join("\n");
}

function section(options: RenderOptions, title: string): string {
  return `${paint(options, "1;2", title.toUpperCase())}\n`;
}

function attemptsView(state: RunState, options: RenderOptions): string {
  const lines: string[] = [section(options, "How the swarm argued")];
  state.attempts.forEach((plan, index) => {
    const critique = state.critiques[index];
    const focus = plan.blocks.find((block) => block.kind === "focus");
    const verdict = critique?.approved ? paint(options, "32", "approved") : paint(options, "31", "rejected");
    lines.push(
      `  ${index + 1}. ${plan.strategy}  ${critique ? `${critique.score}/100` : ""}  ${verdict}`,
    );
    if (focus) {
      lines.push(`     Focus at ${range(focus.start, focus.end)} (${durationLabel(focus.start, focus.end)}).`);
      lines.push(`     ${focus.reason}`);
    }
    const failure = critique?.failures[0];
    if (failure) lines.push(paint(options, "31", `     ${failure.code}. ${failure.detail}`));
    lines.push("");
  });
  return lines.join("\n");
}

function diffBlock(state: RunState, options: RenderOptions): string {
  const plan = state.plan;
  if (!plan) return "  No plan.\n";
  const lines: string[] = [];
  const left = agenda(state.events, options);
  const right = agendaFromPlan(plan, state.events, options);
  const rows = Math.max(left.length, right.length);
  lines.push(`  ${padVisible("BEFORE", COLUMN)}${padVisible("AFTER", COLUMN)}`);
  for (let index = 0; index < rows; index += 1) {
    lines.push(`  ${padVisible(left[index] ?? "", COLUMN)}${right[index] ?? ""}`);
  }
  lines.push("");
  const moved = plan.blocks.filter((block) => {
    const original = state.events.find((event) => event.id === block.id);
    return original && (original.start !== block.start || original.end !== block.end);
  });
  const created = plan.blocks.filter((block) => !state.events.some((event) => event.id === block.id));
  const held = plan.blocks.filter((block) => {
    const original = state.events.find((event) => event.id === block.id);
    return original && original.start === block.start && original.end === block.end;
  });
  if (created.length > 0) {
    lines.push(paint(options, "33", "  New"));
    for (const block of created) lines.push(`    ${range(block.start, block.end).padEnd(13)}  ${block.title}`);
  }
  if (moved.length > 0) {
    lines.push(paint(options, "36", "  Moved"));
    for (const block of moved) {
      const original = state.events.find((event) => event.id === block.id);
      if (!original) continue;
      lines.push(
        `    ${block.title.padEnd(36)}  ${range(original.start, original.end)} → ${range(block.start, block.end)}`,
      );
    }
  }
  lines.push(paint(options, "2", `  Held  ${held.map((block) => block.title).join("  ·  ")}`));
  lines.push("");
  return lines.join("\n");
}

function agenda(events: CalendarEvent[], options: RenderOptions): string[] {
  const clashes = new Set<string>();
  for (const pair of findOverlaps(events)) {
    clashes.add(pair.a.id);
    clashes.add(pair.b.id);
  }
  return [...events]
    .sort((a, b) => a.start - b.start)
    .map((event) => {
      const label = `${range(event.start, event.end)}  ${columnTitle(event.title)}`;
      return clashes.has(event.id) ? paint(options, "31", label) : label;
    });
}

function agendaFromPlan(plan: Plan, events: CalendarEvent[], options: RenderOptions): string[] {
  return plan.blocks.map((block) => {
    const original = events.find((event) => event.id === block.id);
    const fresh = !original;
    const moved = original && (original.start !== block.start || original.end !== block.end);
    const label = `${range(block.start, block.end)}  ${columnTitle(block.title)}`;
    if (fresh) return paint(options, "33", label);
    if (moved) return paint(options, "36", label);
    return label;
  });
}

function renderActions(actions: Action[], options: RenderOptions): string {
  if (actions.length === 0) return "  None.\n";
  const lines: string[] = [];
  for (const action of actions) {
    if (action.type === "calendar.create") {
      lines.push(`  ${paint(options, "33", "calendar.create")}  ${action.to}  ${action.title}`);
    } else if (action.type === "calendar.update") {
      lines.push(`  ${paint(options, "36", "calendar.update")}  ${action.title}`);
      lines.push(`    ${action.from} → ${action.to}`);
    } else if (action.type === "email.draft") {
      lines.push(`  ${paint(options, "33", "email.draft")}  to ${action.to}  ·  staged ${action.sendAt}  ·  ${action.status}`);
      lines.push(paint(options, "1", `    ${action.subject}`));
      lines.push(indent(action.body, 4));
    } else if (action.type === "slack.draft") {
      lines.push(`  ${paint(options, "33", "slack.draft")}  ${action.channel}  ·  ${action.status}`);
      lines.push(indent(action.text, 4));
    }
    lines.push("");
  }
  return lines.join("\n");
}

function footer(state: RunState): string {
  return [
    "─".repeat(WIDTH),
    `Re-run  npm run demo  ·  npm run demo:plan  ·  npm run demo:brief  ·  npm run demo:trace`,
    `Run ${state.runId} used the ${state.modelName} provider. Drafts never leave the process.`,
    "",
  ].join("\n");
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${pad}${line}`)
    .join("\n");
}

function wrap(text: string, width: number, hanging: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.map((line, index) => (index === 0 ? line : `${" ".repeat(hanging)}${line}`)).join("\n");
}

const COLUMN = 36;

const COLUMN_TITLES: Record<string, string> = {
  "Team standup": "Standup",
  "Focus · CaseFlow denial queue": "Focus · CaseFlow",
  "Northwind Health · quarterly review": "Northwind review",
  "1:1 with Samira": "1:1 with Samira",
  Lunch: "Lunch",
  "Wellness walk": "Wellness walk",
  "CaseFlow design review": "CaseFlow review",
  "Halcyon Benefits · batch 441": "Halcyon batch 441",
  "Wrap · ticket hygiene": "Wrap",
  "Prep · Meridian Medical": "Prep · Meridian",
  "Meridian Medical · escalation": "Meridian escalation",
  "Prep · Northwind Health": "Prep · Northwind",
};

function columnTitle(title: string): string {
  return COLUMN_TITLES[title] ?? title;
}

function padVisible(text: string, width: number): string {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (visible.length >= width) return text;
  return text + " ".repeat(width - visible.length);
}

function paint(options: RenderOptions, code: string, text: string): string {
  if (!options.color) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}
