import { findOverlaps, openGaps, overlapMinutes, type Interval } from "./gaps.js";
import { FIXED_LEAD_MINUTES, MORNING_END, MORNING_START, WORK_END, WORK_START, range } from "../time.js";
import type { CalendarEvent, Demand, Plan, PlanBlock, Strategy, Unplaced } from "../types.js";

interface Occupant extends Interval {
  id: string;
}

interface Placeable {
  id: string;
  title: string;
  kind: PlanBlock["kind"];
  duration: number;
  minDuration: number;
  preferredStart: number;
  earliest: number;
  latest: number;
  needsPrepMinutes: number;
  accountId?: string;
  phase: "critical" | "client" | "protected" | "focus" | "other";
}

/**
 * Two honest strategies, not one hidden heuristic.
 *
 * client-first clears client meetings as early as possible, keeps lunch and
 * the walk, then drops focus into the biggest hole that remains. The biggest
 * hole is often the wrong hole.
 *
 * protect-focus places a true escalation first, reserves morning focus before
 * any non-critical meeting, then fits the rest.
 */
export function planSchedule(input: {
  events: CalendarEvent[];
  demands: Demand[];
  strategy: Strategy;
}): Plan {
  const anchors = input.events.filter((event) => event.flexibility === "fixed");
  const floating = input.events.filter((event) => event.flexibility === "movable");
  const occupied: Occupant[] = [];
  const blocks: PlanBlock[] = [];
  const unplaced: Unplaced[] = [];
  const notes: string[] = [];

  for (const anchor of anchors) {
    blocks.push(toBlock(anchor, `${anchor.title} stays. It was marked fixed.`, true));
    occupied.push({ id: anchor.id, start: anchor.start, end: anchor.end });
    occupied.push({
      id: `lead:${anchor.id}`,
      start: anchor.start - FIXED_LEAD_MINUTES,
      end: anchor.start,
    });
  }

  const placeables = floating.map(toPlaceable);
  for (const demand of input.demands) {
    placeables.push(demandToPlaceable(demand));
  }

  const order = orderFor(input.strategy);

  for (const phase of order) {
    const batch = placeables
      .filter((item) => item.phase === phase)
      .sort((a, b) => b.duration - a.duration || a.preferredStart - b.preferredStart);

    for (const item of batch) {
      const placed =
        phase === "focus" && input.strategy === "client-first"
          ? placeLargest(occupied, item)
          : phase === "focus"
            ? placeMorningBias(occupied, item)
            : phase === "critical" || (phase === "client" && input.strategy === "client-first")
              ? placeEarliest(occupied, item)
              : placeNearest(occupied, item);

      if (!placed) {
        unplaced.push({
          id: item.id,
          title: item.title,
          reason: `No gap fits ${item.minDuration} minutes inside ${range(item.earliest, item.latest)}.`,
        });
        continue;
      }

      const reason = reasonFor(input.strategy, item, placed);
      if (placed.prep) {
        blocks.push({
          id: `prep:${item.id}`,
          title: `Prep · ${shortName(item.title)}`,
          kind: "prep",
          start: placed.prep.start,
          end: placed.prep.end,
          reason: `Buffer immediately before ${item.title}.`,
          accountId: item.accountId,
          prepFor: item.id,
          anchor: false,
        });
        occupied.push({ id: `prep:${item.id}`, start: placed.prep.start, end: placed.prep.end });
      }
      blocks.push({
        id: item.id,
        title: item.title,
        kind: item.kind,
        start: placed.start,
        end: placed.end,
        reason,
        accountId: item.accountId,
        anchor: false,
      });
      occupied.push({ id: item.id, start: placed.start, end: placed.end });
      notes.push(`${item.title}: ${reason}`);
    }
  }

  blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  return { strategy: input.strategy, blocks, unplaced, notes };
}

export function chooseStrategy(input: {
  previousFailures: string[];
  hasTriedClientFirst: boolean;
}): Strategy {
  if (!input.hasTriedClientFirst) return "client-first";
  if (input.previousFailures.length === 0) return "client-first";
  return "protect-focus";
}

function orderFor(strategy: Strategy): Placeable["phase"][] {
  if (strategy === "client-first") {
    return ["critical", "client", "protected", "focus", "other"];
  }
  return ["critical", "focus", "protected", "client", "other"];
}

function toBlock(event: CalendarEvent, reason: string, anchor: boolean): PlanBlock {
  return {
    id: event.id,
    title: event.title,
    kind: event.kind,
    start: event.start,
    end: event.end,
    reason,
    accountId: event.accountId,
    anchor,
  };
}

function toPlaceable(event: CalendarEvent): Placeable {
  return {
    id: event.id,
    title: event.title,
    kind: event.kind,
    duration: event.end - event.start,
    minDuration: event.minDuration,
    preferredStart: event.start,
    earliest: event.earliest,
    latest: event.latest,
    needsPrepMinutes: event.needsPrepMinutes,
    accountId: event.accountId,
    phase: phaseOf(event.kind, event.priority, false),
  };
}

function demandToPlaceable(demand: Demand): Placeable {
  return {
    id: demand.id,
    title: demand.title,
    kind: "client",
    duration: demand.duration,
    minDuration: demand.duration,
    preferredStart: demand.earliest,
    earliest: demand.earliest,
    latest: demand.latest,
    needsPrepMinutes: demand.prepMinutes,
    accountId: demand.accountId,
    phase: "critical",
  };
}

function phaseOf(kind: CalendarEvent["kind"], priority: number, demand: boolean): Placeable["phase"] {
  if (demand || (priority >= 5 && kind === "client")) return "critical";
  if (kind === "focus") return "focus";
  if (kind === "break" || kind === "personal") return "protected";
  if (kind === "client") return "client";
  return "other";
}

interface Placement {
  start: number;
  end: number;
  prep?: Interval;
  gapMinutes: number;
  comparedGapMinutes?: number;
}

function placeEarliest(occupied: Occupant[], item: Placeable): Placement | null {
  const candidates = candidatesIn(occupied, item);
  candidates.sort((a, b) => a.start - b.start);
  return candidates[0] ?? null;
}

function placeNearest(occupied: Occupant[], item: Placeable): Placement | null {
  const candidates = candidatesIn(occupied, item);
  candidates.sort((a, b) => {
    const distance = Math.abs(a.start - item.preferredStart) - Math.abs(b.start - item.preferredStart);
    if (distance !== 0) return distance;
    return b.end - b.start - (a.end - a.start);
  });
  return candidates[0] ?? null;
}

function placeLargest(occupied: Occupant[], item: Placeable): Placement | null {
  const candidates = candidatesIn(occupied, item);
  const byGap = new Map<number, Placement>();
  for (const candidate of candidates) {
    const existing = byGap.get(candidate.gapMinutes);
    if (!existing || candidate.start < existing.start) byGap.set(candidate.gapMinutes, candidate);
  }
  const ranked = [...byGap.entries()].sort((a, b) => b[0] - a[0]);
  const best = ranked[0];
  if (!best) return null;
  const runnerUp = ranked[1];
  if (!runnerUp) return best[1];
  return { ...best[1], comparedGapMinutes: runnerUp[0] };
}

function placeMorningBias(occupied: Occupant[], item: Placeable): Placement | null {
  const morning = { start: MORNING_START, end: MORNING_END };
  const candidates = candidatesIn(occupied, item);
  candidates.sort((a, b) => {
    const overlap = overlapMinutes(b, morning) - overlapMinutes(a, morning);
    if (overlap !== 0) return overlap;
    const distance = Math.abs(a.start - item.preferredStart) - Math.abs(b.start - item.preferredStart);
    if (distance !== 0) return distance;
    return b.end - b.start - (a.end - a.start);
  });
  return candidates[0] ?? null;
}

function candidatesIn(occupied: Occupant[], item: Placeable): Placement[] {
  const gaps = openGaps(occupied, WORK_START, WORK_END);
  const found: Placement[] = [];
  for (const gap of gaps) {
    const prep = item.needsPrepMinutes;
    const earliestStart = Math.max(item.earliest, gap.start + prep);
    const available = Math.min(item.latest, gap.end) - earliestStart;
    if (available < item.minDuration) continue;
    const duration = Math.min(item.duration, available);
    const latestStart = Math.min(item.latest, gap.end) - duration;
    if (latestStart < earliestStart) continue;

    const starts = unique([
      earliestStart,
      Math.min(Math.max(item.preferredStart, earliestStart), latestStart),
      latestStart,
    ]);
    for (const start of starts) {
      found.push({
        start,
        end: start + duration,
        prep: prep > 0 ? { start: start - prep, end: start } : undefined,
        gapMinutes: gap.end - gap.start,
      });
    }
  }
  return found.filter((candidate) => (candidate.prep ? candidate.prep.start >= WORK_START : true));
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

function reasonFor(strategy: Strategy, item: Placeable, placed: Placement): string {
  if (item.phase === "critical") {
    return `Earliest opening that ends before the deadline (${range(placed.start, placed.end)}).`;
  }
  if (item.kind === "focus" && strategy === "client-first") {
    const compared = placed.comparedGapMinutes;
    const sizeNote =
      compared === undefined
        ? `The largest opening left is ${placed.gapMinutes} minutes`
        : `The largest opening left is ${placed.gapMinutes} minutes, ahead of a ${compared}-minute alternative`;
    return `Client calls were cleared first, so focus got whatever remained. ${sizeNote}. The biggest hole is not a morning.`;
  }
  if (item.kind === "focus") {
    return `Reserved before non-critical meetings. ${placed.end - placed.start} minutes, starting at the best morning fit.`;
  }
  if (item.kind === "client" && strategy === "client-first") {
    return "Stacked as early as the fixed meetings allow.";
  }
  if (item.kind === "client") {
    return "Moved to the nearest open slot after focus, lunch, and the walk were held.";
  }
  if (item.kind === "break" || item.kind === "personal") {
    return "Protected block, kept as close as possible to its original time.";
  }
  return "Nearest open time that still respects the fixed payer window and the lead-in before it.";
}

export function describeConflicts(events: CalendarEvent[]): string[] {
  return findOverlaps(events).map(
    ({ a, b }) => `${a.title} (${range(a.start, a.end)}) overlaps ${b.title} (${range(b.start, b.end)}).`,
  );
}

function shortName(title: string): string {
  const [head] = title.split("·");
  return (head ?? title).trim();
}
