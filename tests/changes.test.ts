import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diffSweeps } from "../src/agents/changes.js";
import { sweepPortfolio } from "../src/agents/coordinator.js";
import { PORTFOLIO, PORTFOLIO_YESTERDAY } from "../src/fixtures/portfolio.js";

const today = sweepPortfolio(PORTFOLIO);
const yesterday = sweepPortfolio(PORTFOLIO_YESTERDAY);
const changes = diffSweeps(yesterday, today);
const find = (kind: string, jobId?: string) => changes.items.filter((c) => c.kind === kind && (!jobId || c.jobId === jobId));

describe("since yesterday", () => {
  it("dates the comparison", () => {
    assert.equal(changes.since, "2026-03-11");
    assert.equal(changes.today, "2026-03-12");
  });

  it("finds each overnight event in the fixture", () => {
    assert.equal(find("job-new", "J-1042").length, 1);
    assert.match(find("milestone-done", "J-1031")[0]!.title, /Drywall done/);
    assert.match(find("milestone-done", "J-1031")[0]!.detail, /60% complete, up from 40%/);
    assert.equal(find("stage", "J-1045")[0]!.tone, "better");
    assert.ok(find("risk-cleared", "J-1027").some((c) => /lien waiver/.test(c.title)));
    assert.ok(find("risk-cleared", "J-1045").some((c) => /heard from us/.test(c.title)));
  });

  it("calls the new double booking worse and the job it puts at risk", () => {
    const booking = find("risk-new").find((c) => /two jobs/.test(c.title));
    assert.equal(booking?.tone, "worse");
    const status = find("status", "J-1036")[0];
    assert.equal(status?.tone, "worse");
    assert.match(status!.detail, /Was on track/);
  });

  it("does not report the risks that were there both days", () => {
    assert.ok(!changes.items.some((c) => /Bright Spark/.test(c.title)), "expired insurance was already known");
    assert.ok(!changes.items.some((c) => /Clearline/.test(c.title)), "missing Clearline waiver was already known");
  });

  it("lists worse first, then better, then news, with counts that add up", () => {
    const order = { worse: 0, better: 1, news: 2 } as const;
    const ranks = changes.items.map((c) => order[c.tone]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.equal(changes.counts.worse + changes.counts.better + changes.counts.news, changes.items.length);
    assert.deepEqual(changes.items.map((c) => c.id), changes.items.map((_, i) => `C${i + 1}`));
  });

  it("finds nothing when nothing changed", () => {
    assert.deepEqual(diffSweeps(today, today).items, []);
  });
});
