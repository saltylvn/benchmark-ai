import { record } from "../memory/state.js";
import { hm, range } from "../time.js";
import type { Brief, CallCard, PlanBlock, ProseModel, RunState } from "../types.js";

export async function runBriefWriter(state: RunState, model: ProseModel): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const brief = composeBrief(state);
  const facts = [
    state.dateLabel,
    ...brief.outcomes,
    ...brief.schedule.map((row) => `${row.time} ${row.title}`),
  ];
  brief.headline = firstLine(await model.polish({ kind: "brief", draft: brief.headline, facts }));
  state.brief = brief;

  record(state, {
    agent: "brief",
    title: brief.headline,
    detail: brief.outcomes.map((outcome, index) => `${index + 1}. ${outcome}`).join("\n"),
  });
}

function composeBrief(state: RunState): Brief {
  const plan = state.plan;
  if (!plan) {
    return { headline: "No plan.", outcomes: [], watchouts: [], schedule: [] };
  }
  const focus = plan.blocks.find((block) => block.kind === "focus");
  const northwind = plan.blocks.find((block) => block.id === "northwind");
  const meridian = plan.blocks.find((block) => block.id === "meridian");
  const walk = plan.blocks.find((block) => block.kind === "personal");
  const schedule = plan.blocks.map((block) => ({
    time: range(block.start, block.end),
    title: block.title,
    note: movement(state, block),
  }));

  if (state.workflow === "war-room" && meridian) {
    const deadline = state.demands.find((demand) => demand.id === "meridian")?.statusDeadline;
    const research = state.research.find((note) => note.accountId === "meridian");
    return {
      headline: `Meridian gets ${hm(meridian.start)}. The morning focus block still happens.`,
      outcomes: [
        `Take Dana at ${range(meridian.start, meridian.end)} and send the written status by ${deadline ? hm(deadline) : "the deadline"}.`,
        focus
          ? `Keep ${range(focus.start, focus.end)} for the CaseFlow denial queue. That is the build block, and it stayed in the morning.`
          : "The focus block did not survive. Do not pretend it did.",
        northwind
          ? `Move Northwind to ${range(northwind.start, northwind.end)}. It was a quarterly review sitting on top of focus time.`
          : "Northwind still needs a home.",
      ],
      watchouts: [
        walk ? `The wellness walk stays at ${range(walk.start, walk.end)}.` : "The wellness walk is missing.",
        "The 1:1 with Samira did not move.",
        "Halcyon's 15:30 window was not touched.",
      ],
      schedule,
      callCard: research ? callCard(research, meridian) : undefined,
    };
  }

  return {
    headline: focus
      ? `Focus stays ${range(focus.start, focus.end)}. Northwind moves off it.`
      : "The morning needs a decision before you open the laptop all the way.",
    outcomes: [
      focus
        ? `Use ${range(focus.start, focus.end)} on the CaseFlow denial queue. It was already double-booked, and the rewrite gives it back.`
        : "Recover a 90-minute focus block before noon.",
      northwind
        ? `Be ready for Northwind at ${range(northwind.start, northwind.end)}. The numbers exist. The meeting needs a narrative, not a new slot in the morning.`
        : "Give Northwind a real slot.",
      "Leave Halcyon at 15:30. That window is someone else's calendar, not yours.",
    ],
    watchouts: [
      "Nothing on this day is an incident until the inbox says so.",
      walk ? `Walk at ${range(walk.start, walk.end)}. It is on the plan on purpose.` : "The walk fell off the plan.",
    ],
    schedule,
  };
}

function callCard(
  research: { name: string; summary: string; bullets: string[]; questions: string[]; doNotPromise: string[] },
  meeting: PlanBlock,
): CallCard {
  return {
    account: research.name,
    when: range(meeting.start, meeting.end),
    whyNow: research.summary,
    knows: research.bullets,
    questions: research.questions,
    doNotPromise: research.doNotPromise,
    success: "an owner, the next update time, and an honest read on whether Friday still holds",
  };
}

function movement(state: RunState, block: PlanBlock): string {
  const original = state.events.find((event) => event.id === block.id);
  if (!original) return "new";
  if (original.start === block.start && original.end === block.end) return "held";
  return `was ${range(original.start, original.end)}`;
}

function firstLine(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean);
  return line ?? text;
}
