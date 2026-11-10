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
      headline: `Sam gets ${hm(meridian.start)}. The estimate block still happens.`,
      outcomes: [
        `Call Sam at ${range(meridian.start, meridian.end)} and send the note by ${deadline ? hm(deadline) : "the deadline"}.`,
        focus
          ? `Keep ${range(focus.start, focus.end)} to price J-1042. That block stayed in the morning.`
          : "The estimate block did not survive.",
        northwind
          ? `Move Bright Spark to ${range(northwind.start, northwind.end)}. Their certificate is expired, and the check-in was sitting on the estimate block.`
          : "Bright Spark still needs a time.",
      ],
      watchouts: [
        walk ? `The site walk stays at ${range(walk.start, walk.end)}.` : "The site walk is missing.",
        "The check-in with Dave did not move.",
        "The Pinecrest window at 15:30 was not touched.",
      ],
      schedule,
      callCard: research ? callCard(research, meridian) : undefined,
    };
  }

  return {
    headline: focus
      ? `Estimate block stays ${range(focus.start, focus.end)}. Bright Spark moves off it.`
      : "The morning needs a decision before anyone leaves for the site.",
    outcomes: [
      focus
        ? `Use ${range(focus.start, focus.end)} to price J-1042. It was already double-booked, and the rewrite gives it back.`
        : "Recover 90 minutes for the estimate before noon.",
      northwind
        ? `See Bright Spark at ${range(northwind.start, northwind.end)}. The certificate is the issue, not a morning slot.`
        : "Give Bright Spark a time.",
      "Leave the Pinecrest window at 15:30. The county set that time.",
    ],
    watchouts: [
      "No quote goes out until Maria approves the total.",
      walk ? `Site walk at ${range(walk.start, walk.end)}. It is on the plan on purpose.` : "The site walk fell off the plan.",
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
