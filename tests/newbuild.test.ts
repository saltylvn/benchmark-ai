import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, sweepPortfolio } from "../src/agents/coordinator.js";
import { PORTFOLIO } from "../src/fixtures/portfolio.js";
import type { Portfolio } from "../src/portfolio/types.js";

const clone = (): Portfolio => structuredClone(PORTFOLIO);
const sweep = sweepPortfolio(PORTFOLIO);
const risk = (key: string) => sweep.risks.find((r) => r.key === key);
const draftFor = (key: string) => sweep.drafts.find((d) => d.riskId === risk(key)?.id);

describe("new builds: construction-loan draws", () => {
  it("drafts a draw request to the lender, not an invoice to the buyer", () => {
    const r = risk("draw:J-1050:dryin");
    assert.equal(r?.kind, "draw");
    const d = draftFor("draw:J-1050:dryin")!;
    assert.equal(d.to, "draws@granitevalley.example");
    assert.equal(d.task, "drawRequest");
    assert.equal(d.amount, 82200); // 15% of $548,000, computed by code
    assert.match(d.body, /\$82,200/);
  });

  it("still invoices the client on a job without a lender", () => {
    assert.equal(draftFor("invoice:J-1031:drywall")?.to, "m.hayes@example.com");
  });
});

describe("new builds: buyer selections", () => {
  it("blocks on overdue selections and lists only what is due within a week", () => {
    const r = risk("selections:J-1050")!;
    assert.equal(r.level, "blocked");
    assert.match(r.detail, /Kitchen cabinets \(was due Tue, Mar 10\), Tile and flooring \(due Wed, Mar 18\)/);
    assert.doesNotMatch(r.detail, /Exterior paint/); // due Apr 10, not yet
    assert.equal(draftFor("selections:J-1050")!.to, "morgan.park@example.com");
  });

  it("only watches a selection that is due soon but not late", () => {
    assert.equal(risk("selections:J-1051")!.level, "watch");
  });

  it("drops the reminder once the buyer has chosen", () => {
    const p = clone();
    for (const s of p.jobs.find((j) => j.id === "J-1050")!.selections!) s.done = true;
    assert.equal(sweepPortfolio(p).risks.some((r) => r.key === "selections:J-1050"), false);
  });
});

describe("new builds: long-lead orders", () => {
  it("blocks an order that can no longer arrive on time and says how late", () => {
    const r = risk("order:J-1051:Roof trusses")!;
    assert.equal(r.level, "blocked");
    assert.match(r.title, /arrives 10 days late/);
    assert.equal(draftFor("order:J-1051:Roof trusses")!.to, "orders@trussworks.example");
  });

  it("warns before the last day to order and ties it to an open selection", () => {
    const r = risk("order:J-1050:Cabinets")!;
    assert.equal(r.level, "watch");
    assert.match(r.title, /by Fri, Mar 13/);
    assert.match(r.detail, /buyer's selection for it is still open/);
  });

  it("ignores ordered materials and orders with plenty of time", () => {
    assert.equal(risk("order:J-1050:Windows"), undefined);
    const p = clone();
    p.jobs.find((j) => j.id === "J-1051")!.orders![0]!.needBy = addDays(p.today, 120);
    assert.equal(sweepPortfolio(p).risks.some((r) => r.key === "order:J-1051:Roof trusses"), false);
  });
});

describe("new builds: closing dates", () => {
  it("flags a closing the schedule slip eats into, with the projected finish", () => {
    const r = risk("closing:J-1019")!;
    assert.equal(r.level, "watch");
    assert.match(r.detail, /projects to Thu, May 21 \(6 days behind\), leaving 8 of the 14 days/);
    assert.equal(draftFor("closing:J-1019")!.to, "@dave @tomas");
  });

  it("blocks when the projected finish is after closing, and is quiet when there is room", () => {
    const p = clone();
    p.jobs.find((j) => j.id === "J-1019")!.closing = "2026-05-15";
    assert.equal(sweepPortfolio(p).risks.find((r) => r.key === "closing:J-1019")?.level, "blocked");
    assert.equal(risk("closing:J-1050"), undefined); // Jun 12 finish, Jun 26 closing: exactly enough room
  });
});

describe("new builds leave the rest of the sweep alone", () => {
  it("keeps every earlier check's result for the original eight jobs", () => {
    const original = new Set(["J-1042", "J-1031", "J-1038", "J-1027", "J-1045", "J-1036", "J-1019", "J-1047"]);
    const fresh = new Set(["draw", "selections", "order", "closing"]);
    const old = sweep.risks.filter((r) => !fresh.has(r.kind) && (!r.jobId || original.has(r.jobId)));
    assert.equal(old.length, 12);
  });
});
