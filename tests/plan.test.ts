import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EVENTS, MERIDIAN_DEMAND } from "../src/fixtures/tuesday.js";
import { findOverlaps } from "../src/schedule/gaps.js";
import { critiquePlan } from "../src/schedule/critique.js";
import { planSchedule } from "../src/schedule/plan.js";
import { range } from "../src/time.js";
import type { PlanBlock } from "../src/types.js";

function at(blocks: PlanBlock[], id: string): string {
  const block = blocks.find((item) => item.id === id);
  assert.ok(block, `missing block ${id}`);
  return range(block.start, block.end);
}

describe("planner", () => {
  it("starts from a calendar that is already lying", () => {
    const clashes = findOverlaps(EVENTS);
    assert.equal(clashes.length, 1);
    assert.equal(clashes[0]?.a.id, "focus");
    assert.equal(clashes[0]?.b.id, "northwind");
  });

  it("client-first parks focus in the biggest leftover hole", () => {
    const plan = planSchedule({ events: EVENTS, demands: [MERIDIAN_DEMAND], strategy: "client-first" });
    assert.equal(plan.unplaced.length, 0);
    assert.equal(at(plan.blocks, "focus"), "13:30–15:20");
    assert.equal(at(plan.blocks, "meridian"), "09:00–09:40");
    const critique = critiquePlan({ plan, events: EVENTS, demands: [MERIDIAN_DEMAND], revision: 1 });
    assert.equal(critique.approved, false);
    assert.ok(critique.failures.some((failure) => failure.code === "FOCUS_BLOCK"));
  });

  it("protect-focus keeps a morning build block and the walk", () => {
    const plan = planSchedule({ events: EVENTS, demands: [MERIDIAN_DEMAND], strategy: "protect-focus" });
    assert.equal(plan.unplaced.length, 0);
    assert.equal(at(plan.blocks, "standup"), "08:30–08:45");
    assert.equal(at(plan.blocks, "prep:meridian"), "08:45–09:00");
    assert.equal(at(plan.blocks, "meridian"), "09:00–09:40");
    assert.equal(at(plan.blocks, "focus"), "09:40–11:20");
    assert.equal(at(plan.blocks, "one-on-one"), "11:30–12:00");
    assert.equal(at(plan.blocks, "lunch"), "12:00–12:45");
    assert.equal(at(plan.blocks, "wellness"), "13:00–13:30");
    assert.equal(at(plan.blocks, "prep:northwind"), "13:30–13:45");
    assert.equal(at(plan.blocks, "northwind"), "13:45–14:30");
    assert.equal(at(plan.blocks, "caseflow"), "14:30–15:20");
    assert.equal(at(plan.blocks, "halcyon"), "15:30–16:00");
    assert.equal(at(plan.blocks, "wrap"), "16:30–17:00");
    const critique = critiquePlan({ plan, events: EVENTS, demands: [MERIDIAN_DEMAND], revision: 2 });
    assert.deepEqual(
      critique.failures.map((failure) => failure.code),
      [],
    );
    assert.equal(critique.approved, true);
    assert.equal(critique.score, 100);
    assert.equal(findOverlaps(plan.blocks).length, 0);
  });

  it("without an escalation, protect-focus leaves the 09:00 block untouched", () => {
    const plan = planSchedule({ events: EVENTS, demands: [], strategy: "protect-focus" });
    assert.equal(at(plan.blocks, "focus"), "09:00–11:00");
    assert.equal(at(plan.blocks, "northwind"), "13:45–14:30");
    const critique = critiquePlan({ plan, events: EVENTS, demands: [], revision: 2 });
    assert.equal(critique.approved, true);
  });
});
