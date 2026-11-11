import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffSweeps } from "../src/agents/changes.js";
import { daysBetween, sweepPortfolio } from "../src/agents/coordinator.js";
import type { Booking, Job, Milestone, Portfolio, Stage, Sub } from "../src/portfolio/types.js";

/**
 * Evaluation by invariants: generate many random but well-formed portfolios and
 * check rules that must hold for every one of them. Seeded, so a failure names
 * the seed that reproduces it.
 */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TODAY = "2026-03-12";
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function randomPortfolio(seed: number): Portfolio {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
  const pms = ["a", "b", "c", "d"].slice(0, int(2, 4));
  const stages: Stage[] = ["lead", "quote", "scheduled", "in-progress", "closeout"];
  const subs: Sub[] = Array.from({ length: int(2, 6) }, (_, i) => ({
    id: `s${i}`, name: `Sub ${i} (FAKE)`, trade: "Trade", contact: `Contact ${i} (FAKE)`, slack: `#subs-${i}`,
    coiExpires: addDays(TODAY, int(-40, 120)),
  }));
  const jobs: Job[] = Array.from({ length: int(3, 10) }, (_, i) => {
    const n = int(1, 5);
    const shares = Array.from({ length: n }, () => int(1, 4));
    const total = shares.reduce((a, b) => a + b, 0);
    let day = int(-90, -10);
    const milestones: Milestone[] = shares.map((s, k) => {
      day += int(3, 25);
      const planned = addDays(TODAY, day);
      const past = daysBetween(planned, TODAY) > 0;
      const done = past && r() < 0.7 ? addDays(planned, int(-2, 6)) : null;
      const doneReal = done && daysBetween(done, TODAY) >= 0 ? done : null;
      return { id: `m${k}`, name: `Milestone ${k}`, planned, done: doneReal, billPct: s / total, invoiced: doneReal ? r() < 0.6 : undefined };
    });
    return {
      id: `J-${1000 + i}`, name: `Job ${i}`, address: `${i} Example St`, client: `Client ${i} (FAKE)`, clientEmail: `c${i}@example.com`,
      pm: pick(pms), stage: pick(stages), contract: int(10, 500) * 1000, hoursThisWeek: int(2, 30),
      lastClientUpdate: addDays(TODAY, -int(0, 12)), milestones, slackChannel: `#job-${i}`,
      permit: r() < 0.4 ? { id: `PC-${2000 + i}`, expires: addDays(TODAY, int(-5, 60)) } : undefined,
      inspection: r() < 0.3 ? { name: "Inspection", date: addDays(TODAY, int(-2, 5)) } : undefined,
      quoteDue: r() < 0.3 ? addDays(TODAY, int(-1, 3)) : undefined,
      // New-build fields on some jobs: a lender, a closing, buyer selections, long-lead orders.
      lender: r() < 0.4 ? { name: "Bank (FAKE)", email: `draws${i}@bank.example` } : undefined,
      closing: r() < 0.4 ? addDays(TODAY, int(10, 200)) : undefined,
      selections: r() < 0.4 ? Array.from({ length: int(1, 3) }, (_, k) => ({ item: `Selection ${k}`, due: addDays(TODAY, int(-10, 20)), done: r() < 0.3 })) : undefined,
      orders: r() < 0.4 ? Array.from({ length: int(1, 3) }, (_, k) => ({ item: `Order ${k}`, vendor: "Vendor (FAKE)", vendorEmail: `v${k}@vendor.example`, leadDays: int(7, 60), needBy: addDays(TODAY, int(-5, 90)), ordered: r() < 0.4 })) : undefined,
    };
  });
  const bookings: Booking[] = Array.from({ length: int(0, 10) }, () => ({
    subId: pick(subs).id, jobId: pick(jobs).id, date: addDays(TODAY, int(-3, 20)), task: "Work",
  }));
  return {
    company: "Test Co", today: TODAY,
    people: pms.map((id) => ({ id, name: `PM ${id.toUpperCase()} Person`, role: "Project manager" as const, slack: `@${id}`, capacityHours: 40 })),
    jobs, subs, bookings,
    lienWaivers: jobs.filter(() => r() < 0.2).map((j) => ({ subId: pick(subs).id, jobId: j.id, received: r() < 0.5, neededFor: "Final payment" })),
  };
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

function eachSeed(check: (p: Portfolio, seed: number) => void) {
  for (const seed of SEEDS) {
    const p = randomPortfolio(seed);
    try {
      check(p, seed);
    } catch (error) {
      throw new Error(`seed ${seed}: ${(error as Error).message}`);
    }
  }
}

describe("coordinator invariants over 300 random portfolios", () => {
  it("is deterministic", () => {
    eachSeed((p) => assert.deepEqual(sweepPortfolio(p), sweepPortfolio(structuredClone(p))));
  });

  it("only ever drafts, and every draft answers a risk", () => {
    eachSeed((p) => {
      const s = sweepPortfolio(p);
      const ids = new Set(s.risks.map((r) => r.id));
      for (const d of s.drafts) {
        assert.equal(d.status, "draft");
        assert.ok(d.riskId && ids.has(d.riskId), `draft ${d.id} has no risk`);
      }
    });
  });

  it("never bills more than the contract", () => {
    eachSeed((p) => {
      const s = sweepPortfolio(p);
      for (const j of p.jobs) {
        // Invoices and lender draws both bill the contract.
        const billed = s.drafts.filter((d) => d.kind === "invoice" && d.jobId === j.id).reduce((n, d) => n + d.amount!, 0);
        const already = j.milestones.filter((m) => m.invoiced).reduce((n, m) => n + j.contract * (m.billPct ?? 0), 0);
        assert.ok(billed + already <= j.contract + 0.01, `${j.id} billed ${billed + already} of ${j.contract}`);
      }
    });
  });

  it("keeps percent complete in range and status consistent with late milestones", () => {
    eachSeed((p) => {
      for (const st of sweepPortfolio(p).statuses) {
        assert.ok(st.percent >= 0 && st.percent <= 100);
        const late = st.milestones.some((m) => m.state === "late");
        assert.equal(st.status === "behind", late, `${st.jobId} ${st.status} late=${late}`);
      }
    });
  });

  it("never leaks sub names, insurance, or lien details into client emails", () => {
    eachSeed((p) => {
      const clientEmails = new Set(p.jobs.map((j) => j.clientEmail));
      for (const d of sweepPortfolio(p).drafts.filter((x) => clientEmails.has(x.to))) {
        for (const sub of p.subs) assert.ok(!d.body.includes(sub.name), `${d.id} names ${sub.name}`);
        assert.doesNotMatch(d.body, /\b(insurance|lien|certificate)\b/i, `${d.id} ${d.kind} ${d.subject}: ${d.body}`);
      }
    });
  });

  it("never quotes a client a planned date that has already passed", () => {
    eachSeed((p) => {
      const clientEmails = new Set(p.jobs.map((j) => j.clientEmail));
      for (const d of sweepPortfolio(p).drafts.filter((x) => clientEmails.has(x.to) && x.kind === "email")) {
        const m = d.body.match(/planned for (\w{3}), (\w{3}) (\d{1,2})/);
        if (!m) continue;
        const planned = new Date(`${m[2]} ${m[3]}, 2026 UTC`).toISOString().slice(0, 10);
        assert.ok(planned >= p.today, `${d.id} quotes ${planned}`);
      }
    });
  });

  it("flags every same-day double booking exactly once", () => {
    eachSeed((p) => {
      const groups = new Map<string, number>();
      for (const b of p.bookings) groups.set(`${b.subId}|${b.date}`, (groups.get(`${b.subId}|${b.date}`) ?? 0) + 1);
      const expected = [...groups.values()].filter((n) => n > 1).length;
      assert.equal(sweepPortfolio(p).risks.filter((r) => r.kind === "double-booking").length, expected);
    });
  });

  it("accounts for every PM hour", () => {
    eachSeed((p) => {
      const s = sweepPortfolio(p);
      assert.equal(s.workload.reduce((n, w) => n + w.hours, 0), p.jobs.reduce((n, j) => n + j.hoursThisWeek, 0));
    });
  });

  it("puts every job in the digest", () => {
    eachSeed((p) => {
      const digest = sweepPortfolio(p).digest;
      for (const j of p.jobs) assert.ok(digest.includes(j.id), `${j.id} missing`);
    });
  });
  it("gives every risk a unique key within a sweep", () => {
    eachSeed((p) => {
      const keys = sweepPortfolio(p).risks.map((r) => r.key);
      assert.equal(new Set(keys).size, keys.length, keys.join(" "));
    });
  });

  it("diffs both ways: what is new one way is cleared the other way", () => {
    for (const seed of SEEDS.slice(0, 150)) {
      const a = sweepPortfolio(randomPortfolio(seed));
      const b = sweepPortfolio(randomPortfolio(seed + 1000));
      assert.deepEqual(diffSweeps(a, a).items, [], `seed ${seed}`);
      const fwd = diffSweeps(a, b).items;
      const back = diffSweeps(b, a).items;
      assert.equal(fwd.filter((c) => c.kind === "risk-new").length, back.filter((c) => c.kind === "risk-cleared").length, `seed ${seed}`);
      assert.equal(fwd.filter((c) => c.kind === "job-new").length, back.filter((c) => c.kind === "job-gone").length, `seed ${seed}`);
    }
  });
  it("sends draws to the lender, never to the buyer, and only for jobs with a lender", () => {
    eachSeed((p) => {
      const s = sweepPortfolio(p);
      for (const d of s.drafts.filter((x) => x.task === "drawRequest")) {
        const j = p.jobs.find((x) => x.id === d.jobId)!;
        assert.equal(d.to, j.lender?.email, `${d.id} goes to ${d.to}`);
      }
      for (const d of s.drafts.filter((x) => x.task === "invoiceDraft")) {
        assert.equal(p.jobs.find((x) => x.id === d.jobId)!.lender, undefined, `${d.id} invoices a lender-financed job`);
      }
    });
  });

  it("never flags an ordered material, a finished selection, or a finished job's closing", () => {
    eachSeed((p) => {
      for (const r of sweepPortfolio(p).risks) {
        const j = p.jobs.find((x) => x.id === r.jobId);
        if (r.kind === "order") assert.ok(j!.orders!.some((o) => !o.ordered && r.key === `order:${j!.id}:${o.item}`), r.key);
        if (r.kind === "selections") assert.ok(j!.selections!.some((x) => !x.done), r.key);
        if (r.kind === "closing") assert.ok(j!.milestones.some((m) => !m.done), r.key);
      }
    });
  });
});
