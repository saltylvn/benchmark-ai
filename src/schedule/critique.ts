import { findOverlaps } from "./gaps.js";
import { WORK_END, WORK_START, hm, range } from "../time.js";
import type { CalendarEvent, Critique, CritiqueFailure, Demand, Plan, PlanBlock } from "../types.js";

const HARD = 25;

/**
 * The critic is a checklist with teeth. It does not rewrite the day.
 * It either approves the plan or hands a named failure back to the planner.
 */
export function critiquePlan(input: {
  plan: Plan;
  events: CalendarEvent[];
  demands: Demand[];
  revision: number;
}): Critique {
  const failures: CritiqueFailure[] = [];
  const passed: string[] = [];
  const blocks = input.plan.blocks;

  const unplaced = checkUnplaced(input.plan);
  const overlap = checkOverlap(blocks);
  const anchors = checkAnchors(input.events, blocks);
  const hours = checkHours(blocks);
  const focus = checkFocus(input.events, input.demands, blocks);
  const lunch = checkLunch(blocks);
  const wellness = checkWellness(input.events, blocks);
  const deadlines = checkDeadlines(input.demands, blocks);
  const prep = checkPrep(input.events, input.demands, blocks);
  const buffer = checkClientBuffer(blocks);

  judge("UNPLACED", "Every block found a home", unplaced, failures, passed);
  judge("NO_OVERLAP", "No two blocks overlap", overlap, failures, passed);
  judge("ANCHORS", "Fixed meetings stayed put", anchors, failures, passed);
  judge("INSIDE_HOURS", "The day stays inside 08:30–17:30", hours, failures, passed);
  judge("FOCUS_BLOCK", "Morning focus survived", focus, failures, passed);
  judge("LUNCH_WINDOW", "Lunch still lands around noon", lunch, failures, passed);
  judge("WELLNESS", "The walk is still on the day", wellness, failures, passed);
  judge("DEADLINES", "The escalation ends before its deadline", deadlines, failures, passed);
  judge("PREP", "Client calls have a prep buffer", prep, failures, passed);
  judge("CLIENT_BUFFER", "Fixed client windows keep a 10-minute lead-in", buffer, failures, passed);

  const score = Math.max(0, 100 - failures.reduce((sum, failure) => sum + failure.weight, 0));
  return {
    revision: input.revision,
    strategy: input.plan.strategy,
    approved: failures.length === 0,
    score,
    failures,
    passed,
  };
}

function judge(
  code: string,
  passLabel: string,
  failure: CritiqueFailure | null,
  failures: CritiqueFailure[],
  passed: string[],
): void {
  if (failure) failures.push({ ...failure, code });
  else passed.push(passLabel);
}

function checkUnplaced(plan: Plan): CritiqueFailure | null {
  const first = plan.unplaced[0];
  if (!first) return null;
  return {
    code: "UNPLACED",
    weight: 40,
    detail: `${first.title} could not be placed. ${first.reason}`,
  };
}

function checkOverlap(blocks: PlanBlock[]): CritiqueFailure | null {
  const clash = findOverlaps(blocks)[0];
  if (!clash) return null;
  return {
    code: "NO_OVERLAP",
    weight: 40,
    detail: `${clash.a.title} overlaps ${clash.b.title}.`,
  };
}

function checkAnchors(events: CalendarEvent[], blocks: PlanBlock[]): CritiqueFailure | null {
  for (const event of events) {
    if (event.flexibility !== "fixed") continue;
    const block = blocks.find((item) => item.id === event.id);
    if (!block || block.start !== event.start || block.end !== event.end) {
      return {
        code: "ANCHORS",
        weight: 30,
        detail: `${event.title} moved. It was fixed (${range(event.start, event.end)}).`,
      };
    }
  }
  return null;
}

function checkHours(blocks: PlanBlock[]): CritiqueFailure | null {
  const outside = blocks.find((block) => block.start < WORK_START || block.end > WORK_END);
  if (!outside) return null;
  return {
    code: "INSIDE_HOURS",
    weight: 20,
    detail: `${outside.title} sits at ${range(outside.start, outside.end)}, outside working hours.`,
  };
}

function checkFocus(
  events: CalendarEvent[],
  demands: Demand[],
  blocks: PlanBlock[],
): CritiqueFailure | null {
  const focus = blocks.find((block) => block.kind === "focus");
  if (!focus) {
    return { code: "FOCUS_BLOCK", weight: HARD, detail: "The focus block is missing." };
  }
  const minutes = focus.end - focus.start;
  if (minutes < 90) {
    return {
      code: "FOCUS_BLOCK",
      weight: HARD,
      detail: `Focus is ${minutes} minutes. The floor is 90.`,
    };
  }
  const critical = demands.some((demand) => demand.priority >= 5);
  if (!critical) {
    const original = events.find((event) => event.id === focus.id);
    const shift = original ? Math.abs(focus.start - original.start) : 0;
    if (shift > 15) {
      return {
        code: "FOCUS_BLOCK",
        weight: HARD,
        detail: `Focus moved to ${range(focus.start, focus.end)}. Nothing critical happened, so the morning block should stay within 15 minutes of ${hm(original?.start ?? focus.start)}. A larger afternoon hole is not a better morning.`,
      };
    }
    return null;
  }
  if (focus.start > 10 * 60 || focus.end > 12 * 60 + 15) {
    return {
      code: "FOCUS_BLOCK",
      weight: HARD,
      detail: `Focus landed at ${range(focus.start, focus.end)}. The escalation is allowed to shift it, not to push it out of the morning. The largest open gap was the wrong gap.`,
    };
  }
  return null;
}

function checkLunch(blocks: PlanBlock[]): CritiqueFailure | null {
  const lunch = blocks.find((block) => block.kind === "break");
  if (!lunch || lunch.end - lunch.start < 30 || lunch.start < 11 * 60 + 45 || lunch.start > 13 * 60) {
    const where = lunch ? range(lunch.start, lunch.end) : "nowhere";
    return {
      code: "LUNCH_WINDOW",
      weight: 15,
      detail: `Lunch is ${where}. It needs at least 30 minutes and a start between 11:45 and 13:00.`,
    };
  }
  return null;
}

function checkWellness(events: CalendarEvent[], blocks: PlanBlock[]): CritiqueFailure | null {
  const original = events.find((event) => event.kind === "personal" && event.protected);
  const walk = blocks.find((block) => block.kind === "personal");
  if (!original || !walk || walk.end - walk.start < original.minDuration) {
    return {
      code: "WELLNESS",
      weight: 15,
      detail: "The site walk is missing or shorter than 30 minutes. It can slide. It cannot disappear.",
    };
  }
  if (Math.abs(walk.start - original.start) > 90) {
    return {
      code: "WELLNESS",
      weight: 15,
      detail: `The walk slid to ${hm(walk.start)}, more than 90 minutes from ${hm(original.start)}.`,
    };
  }
  return null;
}

function checkDeadlines(demands: Demand[], blocks: PlanBlock[]): CritiqueFailure | null {
  for (const demand of demands) {
    const block = blocks.find((item) => item.id === demand.id);
    if (!block || block.end > demand.latest || block.start < demand.earliest) {
      return {
        code: "DEADLINES",
        weight: HARD,
        detail: block
          ? `${demand.title} ends at ${hm(block.end)}. It has to be done by ${hm(demand.latest)}.`
          : `${demand.title} was not placed.`,
      };
    }
  }
  return null;
}

function checkPrep(events: CalendarEvent[], demands: Demand[], blocks: PlanBlock[]): CritiqueFailure | null {
  const required = [
    ...events
      .filter((event) => event.needsPrepMinutes > 0)
      .map((event) => ({ id: event.id, minutes: event.needsPrepMinutes, title: event.title })),
    ...demands.map((demand) => ({
      id: demand.id,
      minutes: demand.prepMinutes,
      title: demand.title,
    })),
  ];
  for (const item of required) {
    const meeting = blocks.find((block) => block.id === item.id);
    const prep = blocks.find((block) => block.prepFor === item.id);
    if (!meeting || !prep || prep.end !== meeting.start || prep.end - prep.start < item.minutes) {
      return {
        code: "PREP",
        weight: 10,
        detail: `${item.title} needs ${item.minutes} minutes of prep immediately before it.`,
      };
    }
  }
  return null;
}

function checkClientBuffer(blocks: PlanBlock[]): CritiqueFailure | null {
  const ordered = [...blocks].sort((a, b) => a.start - b.start);
  for (const block of ordered) {
    if (block.kind !== "client") continue;
    const previous = [...ordered].reverse().find((item) => item.end <= block.start && item.id !== block.id);
    if (!previous) continue;
    const ownsPrep = previous.prepFor === block.id && previous.end === block.start;
    if (ownsPrep) continue;
    if (previous.end <= block.start - 10) continue;
    return {
      code: "CLIENT_BUFFER",
      weight: 10,
      detail: `${block.title} starts at ${hm(block.start)} with only ${block.start - previous.end} minutes after ${previous.title}. Leave 10, or give it a prep block.`,
    };
  }
  return null;
}
