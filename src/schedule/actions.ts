import { hm, range } from "../time.js";
import type { Account, Action, CalendarEvent, Demand, Plan, PlanBlock } from "../types.js";

export function buildActions(input: {
  events: CalendarEvent[];
  plan: Plan;
  demands: Demand[];
  accounts: Account[];
  persona: string;
}): Action[] {
  const actions: Action[] = [];
  for (const block of input.plan.blocks) {
    const original = input.events.find((event) => event.id === block.id);
    if (!original) {
      actions.push({
        type: "calendar.create",
        id: block.id,
        title: block.title,
        to: range(block.start, block.end),
        reason: block.reason,
        status: "draft",
      });
      continue;
    }
    if (original.start === block.start && original.end === block.end) continue;
    actions.push({
      type: "calendar.update",
      id: block.id,
      title: block.title,
      from: range(original.start, original.end),
      to: range(block.start, block.end),
      reason: block.reason,
      status: "draft",
    });
  }

  for (const demand of input.demands) {
    const account = input.accounts.find((item) => item.id === demand.accountId);
    const meeting = input.plan.blocks.find((block) => block.id === demand.id);
    if (!account || !meeting || demand.statusDeadline === undefined) continue;
    actions.push(emailDraft(input.persona, account, meeting, demand.statusDeadline));
    actions.push(slackDraft(account, input.plan, meeting, demand.statusDeadline));
  }

  return actions;
}

export function missingStatusDrafts(demands: Demand[], actions: Action[]): string[] {
  const gaps: string[] = [];
  for (const demand of demands) {
    if (demand.statusDeadline === undefined) continue;
    const draft = actions.find((action) => action.type === "email.draft" && action.accountId === demand.accountId);
    if (!draft) gaps.push(`No status email was drafted for ${demand.title}.`);
  }
  return gaps;
}

function emailDraft(persona: string, account: Account, meeting: PlanBlock, deadline: number): Action {
  const p0 = account.cases.find((item) => item.priority === "P0");
  const when = range(meeting.start, meeting.end);
  const first = account.owner.split(" ")[0] ?? account.owner;
  const caseLine = p0 ? `I have ${p0.id} open — ${p0.title}.` : account.summary;
  const body = [
    `${first},`,
    "",
    `I can talk at ${when} today.`,
    "",
    `${caseLine} I will not give you a price or a start date on the call. I will send a written note by ${hm(deadline)}, and the quote waits for approval before it goes out.`,
    "",
    `If ${when} does not work, reply before 9:30 and I will move a flexible block.`,
    "",
    persona,
    "Project manager",
  ].join("\n");

  return {
    type: "email.draft",
    to: account.ownerEmail,
    subject: `Re: ${account.name} — morning call at ${hm(meeting.start)}`,
    body,
    accountId: account.id,
    sendAt: hm(deadline),
    status: "draft",
  };
}

function slackDraft(account: Account, plan: Plan, meeting: PlanBlock, deadline: number): Action {
  const focus = plan.blocks.find((block) => block.kind === "focus");
  const northwind = plan.blocks.find((block) => block.id === "northwind");
  const focusLine = focus ? `Estimate block stays ${range(focus.start, focus.end)}.` : "";
  const moveLine = northwind ? `Bright Spark moves to ${hm(northwind.start)}.` : "";
  const text = [
    `${account.owner} is drafted onto the calendar at ${range(meeting.start, meeting.end)}.`,
    focusLine,
    moveLine,
    `Status note to ${account.owner.split(" ")[0] ?? account.owner} is staged for ${hm(deadline)}.`,
    "Nothing has been sent.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    type: "slack.draft",
    channel: account.slackChannel,
    text,
    status: "draft",
  };
}
