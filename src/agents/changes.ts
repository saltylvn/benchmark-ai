import { STAGES } from "../portfolio/types.js";
import type { JobStatus, Risk, Sweep } from "../portfolio/types.js";

/**
 * What changed since the last sweep. A pure diff of two Coordinator sweeps, so
 * "since yesterday" is computed by code from what the agent saw each morning,
 * never written by a model. Risks are matched on their stable `key`.
 */

export type ChangeKind =
  | "job-new"
  | "job-gone"
  | "stage"
  | "handoff"
  | "milestone-done"
  | "status"
  | "risk-new"
  | "risk-cleared"
  | "risk-escalated"
  | "risk-eased";

export type Tone = "worse" | "better" | "news";

export interface Change {
  id: string;
  kind: ChangeKind;
  tone: Tone;
  jobId?: string;
  owner?: string;
  title: string;
  detail: string;
}

export interface Changes {
  since: string;
  today: string;
  counts: Record<Tone, number>;
  items: Change[];
}

const STATUS_RANK: Record<JobStatus["status"], number> = { "on-track": 0, "at-risk": 1, behind: 2 };
const STATUS_LABEL: Record<JobStatus["status"], string> = { "on-track": "on track", "at-risk": "at risk", behind: "behind" };
const STAGE_RANK = new Map(STAGES.map((s, i) => [s.id, i]));
const STAGE_LABEL = new Map(STAGES.map((s) => [s.id, s.label.toLowerCase()]));
const TONE_RANK: Record<Tone, number> = { worse: 0, better: 1, news: 2 };

export function diffSweeps(prev: Sweep, curr: Sweep): Changes {
  const out: Omit<Change, "id">[] = [];
  const before = new Map(prev.statuses.map((s) => [s.jobId, s]));
  const after = new Map(curr.statuses.map((s) => [s.jobId, s]));
  const names = new Map([...prev.workload, ...curr.workload].map((w) => [w.personId, w.name]));
  const who = (id: string) => (names.get(id) ?? id).split(" ")[0]!;
  const label = (s: { jobId: string; name: string }) => `${s.jobId} ${s.name}`;

  for (const s of curr.statuses) {
    const was = before.get(s.jobId);
    if (!was) {
      out.push({ kind: "job-new", tone: "news", jobId: s.jobId, owner: s.pm, title: `New job: ${label(s)}`, detail: `${who(s.pm)} owns it. Stage: ${STAGE_LABEL.get(s.stage)}.` });
      continue;
    }
    if (was.stage !== s.stage) {
      const forward = (STAGE_RANK.get(s.stage) ?? 0) > (STAGE_RANK.get(was.stage) ?? 0);
      out.push({
        kind: "stage", tone: forward ? "better" : "worse", jobId: s.jobId, owner: s.pm,
        title: `${label(s)} moved to ${STAGE_LABEL.get(s.stage)}`,
        detail: `Was ${STAGE_LABEL.get(was.stage)}.`,
      });
    }
    if (was.pm !== s.pm) {
      out.push({ kind: "handoff", tone: "news", jobId: s.jobId, owner: s.pm, title: `${label(s)} handed to ${who(s.pm)}`, detail: `${who(was.pm)} had it.` });
    }
    const doneBefore = new Set(was.milestones.filter((m) => m.done).map((m) => m.id));
    for (const m of s.milestones.filter((x) => x.done && !doneBefore.has(x.id))) {
      out.push({
        kind: "milestone-done", tone: "better", jobId: s.jobId, owner: s.pm,
        title: `${m.name} done on ${label(s)}`,
        detail: `Now ${s.percent}% complete, up from ${was.percent}%.`,
      });
    }
    if (was.status !== s.status) {
      const worse = STATUS_RANK[s.status] > STATUS_RANK[was.status];
      out.push({
        kind: "status", tone: worse ? "worse" : "better", jobId: s.jobId, owner: s.pm,
        title: `${label(s)} now ${STATUS_LABEL[s.status]}`,
        detail: `Was ${STATUS_LABEL[was.status]}. ${s.reason}`,
      });
    }
  }
  for (const s of prev.statuses) {
    if (!after.has(s.jobId)) {
      out.push({ kind: "job-gone", tone: "news", jobId: s.jobId, owner: s.pm, title: `${label(s)} is off the board`, detail: `It was ${s.percent}% complete.` });
    }
  }

  const oldRisks = new Map(prev.risks.map((r) => [r.key, r]));
  const newRisks = new Map(curr.risks.map((r) => [r.key, r]));
  for (const r of curr.risks) {
    const was = oldRisks.get(r.key);
    if (!was) {
      out.push({ kind: "risk-new", tone: r.level === "blocked" ? "worse" : "news", jobId: r.jobId, owner: r.owner, title: r.title, detail: r.detail });
    } else if (was.level !== r.level) {
      const up = r.level === "blocked";
      out.push({
        kind: up ? "risk-escalated" : "risk-eased", tone: up ? "worse" : "better", jobId: r.jobId, owner: r.owner,
        title: `${up ? "Now blocked" : "No longer blocked"}: ${r.title}`,
        detail: r.detail,
      });
    }
  }
  for (const r of prev.risks) {
    if (!newRisks.has(r.key)) out.push(cleared(r));
  }

  const items = out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => TONE_RANK[a.c.tone] - TONE_RANK[b.c.tone] || (a.c.jobId ?? "~").localeCompare(b.c.jobId ?? "~") || a.i - b.i)
    .map(({ c }, i) => ({ id: `C${i + 1}`, ...c }));
  const counts: Record<Tone, number> = { worse: 0, better: 0, news: 0 };
  for (const c of items) counts[c.tone] += 1;
  return { since: prev.today, today: curr.today, counts, items };
}

function cleared(r: Risk): Omit<Change, "id"> {
  return { kind: "risk-cleared", tone: "better", jobId: r.jobId, owner: r.owner, title: `Cleared: ${r.title}`, detail: "The morning sweep no longer finds it." };
}
