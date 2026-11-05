export interface Interval {
  start: number;
  end: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function overlapMinutes(a: Interval, b: Interval): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return Math.max(0, end - start);
}

/** Open intervals inside [from, to] after subtracting occupied time. */
export function openGaps(occupied: Interval[], from: number, to: number): Interval[] {
  const sorted = occupied
    .filter((block) => block.end > from && block.start < to)
    .map((block) => ({
      start: Math.max(block.start, from),
      end: Math.min(block.end, to),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const result: Interval[] = [];
  let cursor = from;
  for (const block of sorted) {
    if (block.start > cursor) result.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < to) result.push({ start: cursor, end: to });
  return result.filter((gap) => gap.end > gap.start);
}

export function findOverlaps<T extends Interval & { id: string; title: string }>(
  items: T[],
): { a: T; b: T }[] {
  const found: { a: T; b: T }[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const left = items[i];
    if (!left) continue;
    for (let j = i + 1; j < items.length; j += 1) {
      const right = items[j];
      if (!right) continue;
      if (overlaps(left, right)) found.push({ a: left, b: right });
    }
  }
  return found;
}
