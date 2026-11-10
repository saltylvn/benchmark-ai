import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { daysBetween, jobStatus, money, sweepPortfolio } from "../src/agents/coordinator.js";
import { PORTFOLIO } from "../src/fixtures/portfolio.js";
import type { Portfolio } from "../src/portfolio/types.js";

const sweep = sweepPortfolio(PORTFOLIO);
const kinds = (kind: string) => sweep.risks.filter((r) => r.kind === kind);

function clone(): Portfolio {
  return JSON.parse(JSON.stringify(PORTFOLIO)) as Portfolio;
}

describe("coordinator sweep", () => {
  it("never sends anything", () => {
    assert.ok(sweep.drafts.length > 0);
    assert.ok(sweep.drafts.every((d) => d.status === "draft"));
  });

  it("blocks a booked sub with an expired certificate and drafts the ask", () => {
    const risk = kinds("insurance").find((r) => r.title.startsWith("Bright Spark"));
    assert.equal(risk?.level, "blocked");
    assert.equal(risk?.jobId, "J-1038");
    assert.ok(sweep.drafts.some((d) => d.riskId === risk?.id && d.to === "#subs-brightspark"));
  });

  it("blocks a sub whose certificate ends before their booked work", () => {
    const risk = kinds("insurance").find((r) => r.title.startsWith("Tilewright"));
    assert.equal(risk?.level, "blocked");
    assert.match(risk!.detail, /Tue, Mar 24/);
  });

  it("ignores subs with no upcoming bookings and healthy certificates", () => {
    assert.equal(kinds("insurance").length, 2);
  });

  it("bills completed milestones with code-computed amounts", () => {
    const invoice = sweep.drafts.find((d) => d.kind === "invoice");
    assert.equal(invoice?.jobId, "J-1031");
    assert.equal(invoice?.amount, 12400);
    assert.match(invoice!.body, /\$12,400/);
  });

  it("holds the final payment until the lien waiver arrives", () => {
    const risk = kinds("lien-waiver")[0];
    assert.equal(risk?.jobId, "J-1027");
    assert.match(risk!.detail, /\$7,440/);
  });

  it("finds the double-booked framing crew and keeps it on the job that is further behind", () => {
    const risk = kinds("double-booking")[0];
    assert.ok(risk);
    assert.match(risk.detail, /Cedar duplex has the earlier milestone/);
  });

  it("drafts an update for a client who has waited a week", () => {
    const risk = kinds("client-update")[0];
    assert.equal(risk?.jobId, "J-1031");
    const email = sweep.drafts.find((d) => d.riskId === risk?.id);
    assert.match(email!.body, /60% through the project/);
  });

  it("flags the permit that expires before the work ends", () => {
    const risk = kinds("permit")[0];
    assert.equal(risk?.jobId, "J-1019");
    assert.equal(risk?.level, "watch");
  });

  it("proposes handing an early-stage job from the heaviest PM to the lightest", () => {
    const reassign = sweep.drafts.find((d) => d.kind === "reassign");
    assert.equal(reassign?.jobId, "J-1047");
    assert.match(reassign!.subject, /Jordan Pike/);
    assert.equal(sweep.workload.find((w) => w.personId === "tomas")?.load, "heavy");
  });

  it("does not propose a handoff when nobody is overloaded", () => {
    const p = clone();
    p.jobs.find((j) => j.id === "J-1019")!.hoursThisWeek = 20;
    assert.equal(sweepPortfolio(p).drafts.filter((d) => d.kind === "reassign").length, 0);
  });

  it("reports one step per check with what it looked at and found", () => {
    assert.equal(sweep.steps.length, 8);
    assert.equal(
      sweep.steps.reduce((n, s) => n + s.found, 0),
      sweep.risks.filter((r) => r.kind !== "late-milestone").length,
    );
  });
});

describe("job status", () => {
  it("marks a job behind when a milestone is past due", () => {
    const cedar = sweep.statuses.find((s) => s.jobId === "J-1019")!;
    assert.equal(cedar.status, "behind");
    assert.equal(cedar.daysLate, 6);
    assert.equal(cedar.percent, 35);
  });

  it("weights progress by billing share", () => {
    const hayes = sweep.statuses.find((s) => s.jobId === "J-1031")!;
    assert.equal(hayes.percent, 60);
    assert.equal(hayes.status, "on-track");
    assert.equal(hayes.nextMilestone?.name, "Finish carpentry");
  });

  it("marks a job at risk when a blocking issue is attached", () => {
    assert.equal(sweep.statuses.find((s) => s.jobId === "J-1038")!.status, "at-risk");
  });

  it("counts a milestone due today as upcoming, not late", () => {
    const p = clone();
    const rivera = p.jobs.find((j) => j.id === "J-1042")!;
    assert.equal(jobStatus(rivera, p.today, []).milestones[0]!.state, "upcoming");
  });
});

describe("helpers", () => {
  it("counts whole days", () => {
    assert.equal(daysBetween("2026-03-12", "2026-03-25"), 13);
    assert.equal(daysBetween("2026-03-12", "2026-02-28"), -12);
  });

  it("formats dollars", () => {
    assert.equal(money(12400), "$12,400");
  });
});

describe("digest", () => {
  it("puts every job and every blocker on one page", () => {
    for (const job of PORTFOLIO.jobs) assert.match(sweep.digest, new RegExp(job.id));
    assert.match(sweep.digest, /8 jobs: 3 on track, 4 at risk, 1 behind/);
    assert.match(sweep.digest, /\*Blocked\*/);
  });
});
