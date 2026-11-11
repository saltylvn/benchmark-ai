import type {
  Draft,
  Job,
  JobStatus,
  Portfolio,
  Risk,
  Sweep,
  SweepStep,
  Workload,
} from "../portfolio/types.js";
import { STAGES } from "../portfolio/types.js";

/**
 * The Coordinator sweeps every job, sub, and PM each morning. It is a pure
 * function of the portfolio and the date: it reads, flags, and drafts. It never
 * sends. Dollar figures are computed here, never by a model.
 */

const DAY_MS = 86_400_000;
export const RULES = {
  /** Warn this many days before a sub's insurance certificate lapses. */
  coiWarnDays: 14,
  /** Warn this many days before a permit expires. */
  permitWarnDays: 21,
  /** A client without an update for this many days gets a drafted note. */
  clientUpdateDays: 4,
  /** Hours over capacity share that count as heavy. */
  heavyShare: 0.9,
  lightShare: 0.5,
} as const;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function money(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Never tell a client a planned date that has already passed. */
function nextLine(status: JobStatus, today: string): string {
  const next = status.nextMilestone;
  if (!next) return "";
  if (daysBetween(next.planned, today) > 0) {
    return `Next up is ${next.name.toLowerCase()}. It is running behind the original plan, and I will confirm a new date with you this week.`;
  }
  return `Next up is ${next.name.toLowerCase()}, planned for ${shortDate(next.planned)}.`;
}

export function jobStatus(job: Job, today: string, risks: Risk[]): JobStatus {
  const milestones = job.milestones.map((m) => {
    const late = m.done === null && daysBetween(m.planned, today) > 0 ? daysBetween(m.planned, today) : 0;
    const slipped = m.done !== null ? Math.max(0, daysBetween(m.planned, m.done)) : late;
    return { ...m, state: (m.done ? "done" : late > 0 ? "late" : "upcoming") as "done" | "late" | "upcoming", daysLate: slipped };
  });
  const weights = milestones.map((m) => m.billPct ?? 1 / milestones.length);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const done = milestones.reduce((sum, m, i) => sum + (m.done ? weights[i]! : 0), 0);
  const percent = Math.round((done / total) * 100);
  const lateNow = milestones.filter((m) => m.state === "late");
  const daysLate = Math.max(0, ...lateNow.map((m) => m.daysLate));
  const blocked = risks.filter((r) => r.jobId === job.id && r.level === "blocked");
  const next = milestones.find((m) => !m.done) ?? null;

  let status: JobStatus["status"] = "on-track";
  let reason = next ? `Next: ${next.name} ${shortDate(next.planned)}.` : "All milestones done.";
  if (lateNow.length > 0) {
    status = "behind";
    reason = `${lateNow[0]!.name} is ${daysLate} day${daysLate === 1 ? "" : "s"} late.`;
  } else if (blocked.length > 0) {
    status = "at-risk";
    reason = blocked[0]!.title;
  }
  return {
    jobId: job.id,
    name: job.name,
    pm: job.pm,
    stage: job.stage,
    percent,
    status,
    reason,
    daysLate,
    nextMilestone: next ? { name: next.name, planned: next.planned } : null,
    milestones,
  };
}

export function sweepPortfolio(p: Portfolio): Sweep {
  const risks: Risk[] = [];
  const drafts: Draft[] = [];
  const steps: SweepStep[] = [];
  const job = (id: string) => p.jobs.find((j) => j.id === id)!;
  const person = (id: string) => p.people.find((x) => x.id === id)!;
  const add = (r: Omit<Risk, "id">) => {
    const risk = { ...r, id: `R${risks.length + 1}` };
    risks.push(risk);
    return risk;
  };
  const draft = (d: Omit<Draft, "id" | "status">) => drafts.push({ ...d, id: `D${drafts.length + 1}`, status: "draft" });

  // 1. Insurance certificates, only for subs booked on upcoming work.
  let found = 0;
  for (const sub of p.subs) {
    const upcoming = p.bookings.filter((b) => b.subId === sub.id && daysBetween(p.today, b.date) >= 0);
    if (upcoming.length === 0) continue;
    const left = daysBetween(p.today, sub.coiExpires);
    const first = upcoming[0]!;
    const owner = job(first.jobId).pm;
    if (left < 0 || daysBetween(sub.coiExpires, first.date) > 0) {
      found += 1;
      const r = add({
        key: `insurance:${sub.id}`, kind: "insurance", level: "blocked", jobId: first.jobId, owner,
        title: `${sub.name} insurance ${left < 0 ? "expired" : "lapses before their work"}`,
        detail: `Certificate ${left < 0 ? `expired ${shortDate(sub.coiExpires)}` : `ends ${shortDate(sub.coiExpires)}`}. Booked ${first.task.toLowerCase()} on ${first.jobId} ${shortDate(first.date)}. Not cleared to work.`,
        due: first.date,
      });
      draft({
        kind: "slack", riskId: r.id, owner, to: sub.slack, jobId: first.jobId, task: "subNudge",
        subject: `Insurance certificate for ${first.jobId}`,
        body: `Hi ${sub.contact.replace(" (FAKE)", "")}, we need a current certificate of insurance before ${shortDate(first.date)} (${first.task.toLowerCase()} on ${first.jobId}). Can you send it today? Thanks.`,
      });
    } else if (left <= RULES.coiWarnDays) {
      found += 1;
      const r = add({
        key: `insurance:${sub.id}`, kind: "insurance", level: "watch", jobId: first.jobId, owner,
        title: `${sub.name} insurance ends in ${left} days`,
        detail: `Certificate ends ${shortDate(sub.coiExpires)}. Next booking ${first.jobId} ${shortDate(first.date)}.`,
        due: sub.coiExpires,
      });
      draft({
        kind: "slack", riskId: r.id, owner, to: sub.slack, jobId: first.jobId, task: "subNudge",
        subject: "Insurance renewal",
        body: `Hi ${sub.contact.replace(" (FAKE)", "")}, your certificate of insurance on file ends ${shortDate(sub.coiExpires)}. Please send the renewal before then so ${first.jobId} stays on schedule.`,
      });
    }
  }
  steps.push({ agent: "coordinator", check: "Insurance certificates for booked subs", looked: p.subs.length, found });

  // 2. Permits and inspections.
  found = 0;
  for (const j of p.jobs) {
    if (j.permit) {
      const left = daysBetween(p.today, j.permit.expires);
      const unfinished = j.milestones.some((m) => !m.done && daysBetween(j.permit!.expires, m.planned) > 0);
      if (left <= RULES.permitWarnDays && unfinished) {
        found += 1;
        const r = add({
          key: `permit:${j.id}`, kind: "permit", level: left <= 7 ? "blocked" : "watch", jobId: j.id, owner: j.pm,
          title: `Permit ${j.permit.id} expires in ${left} days`,
          detail: `Work on ${j.name} is planned past ${shortDate(j.permit.expires)}. File the extension now.`,
          due: j.permit.expires,
        });
        draft({
          kind: "email", riskId: r.id, owner: j.pm, to: "permits@county.example", jobId: j.id, task: "permitCheck",
          subject: `Extension request, permit ${j.permit.id}, ${j.address}`,
          body: `Hello,\n\nWe are requesting an extension for permit ${j.permit.id} at ${j.address}. It expires ${shortDate(j.permit.expires)} and work is scheduled through ${shortDate(j.milestones.at(-1)!.planned)}.\n\nThank you,\n${person(j.pm).name}\n${p.company}`,
        });
      }
    }
    if (j.inspection && daysBetween(p.today, j.inspection.date) >= 0 && daysBetween(p.today, j.inspection.date) <= 2) {
      found += 1;
      add({
        key: `inspection:${j.id}`, kind: "inspection", level: "watch", jobId: j.id, owner: j.pm,
        title: `${j.inspection.name} ${daysBetween(p.today, j.inspection.date) === 0 ? "today" : shortDate(j.inspection.date)}`,
        detail: j.inspection.who ? `${j.inspection.who} meets the inspector.` : "Nobody is assigned to meet the inspector yet.",
        due: j.inspection.date,
      });
    }
  }
  steps.push({ agent: "coordinator", check: "Permits and inspections", looked: p.jobs.length, found });

  // 3. Lien waivers blocking payment.
  found = 0;
  for (const w of p.lienWaivers.filter((x) => !x.received)) {
    found += 1;
    const j = job(w.jobId);
    const sub = p.subs.find((s) => s.id === w.subId)!;
    const final = j.milestones.find((m) => !m.done && m.billPct);
    const held = final ? j.contract * (final.billPct ?? 0) : 0;
    const r = add({
      key: `lien-waiver:${w.subId}:${j.id}`, kind: "lien-waiver", level: "blocked", jobId: j.id, owner: j.pm,
      title: `${sub.name} lien waiver missing`,
      detail: `${w.neededFor} on ${j.name} (${money(held)}) cannot be collected until it arrives.`,
      due: final?.planned,
    });
    draft({
      kind: "slack", riskId: r.id, owner: j.pm, to: sub.slack, jobId: j.id, task: "lienChase",
      subject: `Lien waiver for ${j.id}`,
      body: `Hi ${sub.contact.replace(" (FAKE)", "")}, we still need your final lien waiver for ${j.name} (${j.id}) so we can close out. Could you send it by tomorrow?`,
    });
  }
  steps.push({ agent: "coordinator", check: "Lien waivers before final payments", looked: p.lienWaivers.length, found });

  // 4. Milestones done but not invoiced.
  found = 0;
  for (const j of p.jobs) {
    for (const m of j.milestones.filter((x) => x.done && x.billPct && !x.invoiced)) {
      found += 1;
      const amount = j.contract * m.billPct!;
      const r = add({
        key: `invoice:${j.id}:${m.id}`, kind: "invoice", level: "watch", jobId: j.id, owner: j.pm,
        title: `${j.name}: ${m.name} done, not billed`,
        detail: `${Math.round(m.billPct! * 100)}% of ${money(j.contract)} = ${money(amount)} ready to invoice.`,
      });
      draft({
        kind: "invoice", riskId: r.id, owner: j.pm, to: j.clientEmail, jobId: j.id, amount, task: "invoiceDraft",
        subject: `Invoice: ${j.name}, ${m.name}`,
        body: `${m.name} was completed ${shortDate(m.done!)}. Progress billing ${Math.round(m.billPct! * 100)}% of the ${money(j.contract)} contract: ${money(amount)}.`,
      });
    }
  }
  steps.push({ agent: "coordinator", check: "Completed milestones not yet invoiced", looked: p.jobs.length, found });

  // 5. Clients waiting on an update.
  found = 0;
  for (const j of p.jobs.filter((x) => x.stage !== "lead")) {
    const quiet = daysBetween(j.lastClientUpdate, p.today);
    if (quiet < RULES.clientUpdateDays) continue;
    found += 1;
    const status = jobStatus(j, p.today, []);
    const r = add({
      key: `client-update:${j.id}`, kind: "client-update", level: "watch", jobId: j.id, owner: j.pm,
      title: `${j.client} has not heard from us in ${quiet} days`,
      detail: `${j.name} is ${status.percent}% complete. ${status.reason}`,
    });
    const done = status.milestones.filter((m) => m.done).map((m) => m.name.toLowerCase());
    draft({
      kind: "email", riskId: r.id, owner: j.pm, to: j.clientEmail, jobId: j.id, task: "clientUpdate",
      subject: `${j.name} update`,
      body: `Hi ${j.client.split(" ")[0]},\n\nQuick update on ${j.name}: ${done.length ? `${done.join(", ")} ${done.length === 1 ? "is" : "are"} done` : "work is underway"}, and we are ${status.percent}% through the project. ${nextLine(status, p.today)}\n\nI will send the next update when that is complete.\n\n${person(j.pm).name}`,
    });
  }
  steps.push({ agent: "coordinator", check: "Clients waiting on an update", looked: p.jobs.length, found });

  // 6. Subs double-booked across jobs.
  found = 0;
  const seen = new Map<string, typeof p.bookings>();
  for (const b of p.bookings) {
    const key = `${b.subId}|${b.date}`;
    seen.set(key, [...(seen.get(key) ?? []), b]);
  }
  for (const [key, list] of seen) {
    if (list.length < 2) continue;
    found += 1;
    const sub = p.subs.find((s) => s.id === key.split("|")[0])!;
    const [a, b] = [job(list[0]!.jobId), job(list[1]!.jobId)];
    // The job whose next open milestone comes first keeps the crew. A job with nothing open sorts last.
    const nextOpen = (j: Job) => j.milestones.find((m) => !m.done)?.planned ?? "9999-12-31";
    const later = nextOpen(b) < nextOpen(a) ? a : nextOpen(a) < nextOpen(b) ? b : b;
    const keep = later === a ? b : a;
    const r = add({
      key: `double-booking:${key}`, kind: "double-booking", level: "blocked", jobId: later.id, owner: later.pm,
      title: `${sub.name} booked on two jobs ${shortDate(list[0]!.date)}`,
      detail: `${keep.id} (${person(keep.pm).name}) and ${later.id} (${person(later.pm).name}). ${keep.name} has the earlier milestone, so it keeps the crew.`,
      due: list[0]!.date,
    });
    draft({
      kind: "slack", riskId: r.id, owner: later.pm, to: `${person(keep.pm).slack} ${person(later.pm).slack}`, jobId: later.id, task: "conflictResolution",
      subject: `${sub.name} double-booked`,
      body: `${sub.name} is booked on ${keep.id} and ${later.id} on ${shortDate(list[0]!.date)}. Proposal: ${keep.id} keeps the crew (earlier milestone), ${later.id} moves to the next open day. Reply here to confirm.`,
    });
  }
  steps.push({ agent: "coordinator", check: "Subs booked on two jobs the same day", looked: p.bookings.length, found });

  // 7. Quotes due.
  found = 0;
  for (const j of p.jobs.filter((x) => x.quoteDue && daysBetween(p.today, x.quoteDue) <= 1 && daysBetween(p.today, x.quoteDue) >= 0)) {
    found += 1;
    add({
      key: `quote-due:${j.id}`, kind: "quote-due", level: "watch", jobId: j.id, owner: j.pm,
      title: `Quote for ${j.name} due ${daysBetween(p.today, j.quoteDue!) === 0 ? "today" : "tomorrow"}`,
      detail: `${money(j.contract)} estimate for ${j.client}.`,
      due: j.quoteDue,
    });
  }
  steps.push({ agent: "coordinator", check: "Quotes due in the next day", looked: p.jobs.length, found });

  // Statuses use the risks found above.
  const statuses = p.jobs.map((j) => jobStatus(j, p.today, risks));
  for (const s of statuses.filter((x) => x.status === "behind")) {
    add({
      key: `late-milestone:${s.jobId}`, kind: "late-milestone", level: "blocked", jobId: s.jobId, owner: s.pm,
      title: `${s.name} is behind`,
      detail: s.reason,
    });
  }

  // 8. Workload and a rebalance proposal.
  const workload: Workload[] = p.people
    .filter((x) => x.role === "Project manager")
    .map((x) => {
      const jobs = p.jobs.filter((j) => j.pm === x.id);
      const hours = jobs.reduce((sum, j) => sum + j.hoursThisWeek, 0);
      const share = hours / x.capacityHours;
      return {
        personId: x.id, name: x.name, jobs: jobs.map((j) => j.id), hours, capacity: x.capacityHours,
        openRisks: risks.filter((r) => r.owner === x.id).length,
        load: share >= RULES.heavyShare ? "heavy" : share < RULES.lightShare ? "light" : "ok",
      };
    });
  found = 0;
  const heaviest = [...workload].sort((a, b) => b.hours / b.capacity - a.hours / a.capacity)[0]!;
  const lightest = [...workload].sort((a, b) => a.hours / a.capacity - b.hours / b.capacity)[0]!;
  if (heaviest.load === "heavy" && lightest.load === "light") {
    const movable = p.jobs
      .filter((j) => j.pm === heaviest.personId && (j.stage === "lead" || j.stage === "quote"))
      .sort((a, b) => a.hoursThisWeek - b.hoursThisWeek)[0];
    if (movable) {
      found += 1;
      const r = add({
        key: `workload:${heaviest.personId}`, kind: "workload", level: "watch", owner: heaviest.personId, jobId: movable.id,
        title: `${heaviest.name} is at ${heaviest.hours} of ${heaviest.capacity} hours`,
        detail: `${lightest.name} has ${lightest.capacity - lightest.hours} hours free. ${movable.name} is early-stage and easy to hand over.`,
      });
      draft({
        kind: "reassign", riskId: r.id, owner: heaviest.personId, to: `${person(heaviest.personId).slack} ${person(lightest.personId).slack}`, jobId: movable.id, task: "reassign",
        subject: `Hand ${movable.id} to ${lightest.name}`,
        body: `Proposal: ${lightest.name} takes ${movable.name} (${movable.id}, ${movable.hoursThisWeek} h this week). ${heaviest.name} drops to ${heaviest.hours - movable.hoursThisWeek} h; ${lightest.name} goes to ${lightest.hours + movable.hoursThisWeek} h.`,
      });
    }
  }
  steps.push({ agent: "coordinator", check: "PM workload against capacity", looked: workload.length, found });

  return {
    today: p.today,
    company: p.company,
    statuses,
    risks,
    drafts,
    workload,
    steps,
    digest: buildDigest(p, statuses, risks, drafts),
  };
}

export function buildDigest(p: Portfolio, statuses: JobStatus[], risks: Risk[], drafts: Draft[]): string {
  const count = (s: JobStatus["status"]) => statuses.filter((x) => x.status === s).length;
  const name = (id: string) => p.people.find((x) => x.id === id)?.name.split(" ")[0] ?? id;
  const lines = [
    `*${p.company} · morning status, ${shortDate(p.today)}*`,
    `${statuses.length} jobs: ${count("on-track")} on track, ${count("at-risk")} at risk, ${count("behind")} behind. ${drafts.length} drafts waiting for approval.`,
    "",
    ...STAGES.flatMap((stage) => {
      const rows = statuses.filter((s) => s.stage === stage.id);
      if (rows.length === 0) return [];
      return [
        `_${stage.label}_`,
        ...rows.map((s) => `• ${s.jobId} ${s.name} (${name(s.pm)}) ${s.percent}% · ${s.status.replace("-", " ")} · ${s.reason}`),
      ];
    }),
    "",
    "*Blocked*",
    ...risks.filter((r) => r.level === "blocked").map((r) => `• ${r.title} → ${name(r.owner)}`),
  ];
  return lines.join("\n");
}
