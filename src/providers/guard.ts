import type { ProseModel } from "../types.js";

/**
 * A model may restyle prose. It may not change a fact. This guard pulls every
 * hard fact out of the deterministic draft (times, money, job and case ids,
 * dates, percentages, channels, emails) and rejects a rewrite that drops one,
 * changes one, or adds a new one. A rejected rewrite falls back to the draft.
 */

const PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "time", re: /\b(?:[01]\d|2[0-3]):[0-5]\d\b/g },
  { kind: "money", re: /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g },
  { kind: "id", re: /\b(?:J|COI|INSP|PC)-\d{3,4}(?:-\d{4})?\b/g },
  { kind: "date", re: /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b/g },
  { kind: "percent", re: /\b\d{1,3}%/g },
  { kind: "channel", re: /(?<![\w#])#[a-z0-9][a-z0-9-]*/g },
  { kind: "email", re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
];

export interface Fact {
  kind: string;
  value: string;
}

function normalize(kind: string, value: string): string {
  if (kind === "date") {
    // "March 12" and "Mar 12" are the same date.
    const [month, day] = value.replace(".", "").split(" ");
    return `${month!.slice(0, 3)} ${day}`;
  }
  return value.toLowerCase();
}

export function extractFacts(text: string): Fact[] {
  const seen = new Map<string, Fact>();
  for (const { kind, re } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      const value = normalize(kind, match[0]);
      seen.set(`${kind}:${value}`, { kind, value });
    }
  }
  return [...seen.values()];
}

export interface GuardResult {
  text: string;
  accepted: boolean;
  missing: Fact[];
  added: Fact[];
  reason?: string;
}

/** Longest a rewrite may grow before it is treated as invention, as a multiple of the draft. */
export const MAX_GROWTH = 1.6;

export function guardRewrite(draft: string, rewrite: string): GuardResult {
  const candidate = rewrite.trim();
  if (!candidate) return { text: draft, accepted: false, missing: [], added: [], reason: "empty rewrite" };
  if (candidate.length > draft.length * MAX_GROWTH + 40) {
    return { text: draft, accepted: false, missing: [], added: [], reason: "rewrite grew too long" };
  }
  const key = (f: Fact) => `${f.kind}:${f.value}`;
  const before = extractFacts(draft);
  const after = extractFacts(candidate);
  const afterKeys = new Set(after.map(key));
  const beforeKeys = new Set(before.map(key));
  const missing = before.filter((f) => !afterKeys.has(key(f)));
  const added = after.filter((f) => !beforeKeys.has(key(f)));
  if (missing.length || added.length) {
    const parts = [
      missing.length ? `dropped ${missing.map((f) => f.value).join(", ")}` : "",
      added.length ? `added ${added.map((f) => f.value).join(", ")}` : "",
    ].filter(Boolean);
    return { text: draft, accepted: false, missing, added, reason: parts.join("; ") };
  }
  return { text: candidate, accepted: true, missing: [], added: [] };
}

export interface GuardLog {
  kind: string;
  accepted: boolean;
  reason?: string;
}

/** Wrap any prose model so every rewrite passes the fact guard. */
export function guarded(model: ProseModel, log: GuardLog[] = []): ProseModel & { log: GuardLog[] } {
  return {
    name: model.name,
    log,
    async polish(input) {
      let rewrite: string;
      try {
        rewrite = await model.polish(input);
      } catch {
        log.push({ kind: input.kind, accepted: false, reason: "model call failed" });
        return input.draft;
      }
      if (rewrite === input.draft) return input.draft;
      const result = guardRewrite(input.draft, rewrite);
      log.push({ kind: input.kind, accepted: result.accepted, reason: result.reason });
      return result.text;
    },
  };
}
