import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractFacts, guarded, guardRewrite } from "../src/providers/guard.js";

const DRAFT =
  "Sam, I can talk at 09:00–09:40 today. I have J-1042 open. The draft total is $38,450 and the note goes out by 12:15 on Mar 12. Crew notes go to #job-j1042.";

describe("fact extraction", () => {
  it("finds times, money, ids, dates, and channels", () => {
    const kinds = extractFacts(DRAFT).map((f) => `${f.kind}:${f.value}`);
    for (const want of ["time:09:00", "time:09:40", "time:12:15", "money:$38,450", "id:j-1042", "date:Mar 12", "channel:#job-j1042"]) {
      assert.ok(kinds.includes(want), `missing ${want} in ${kinds.join(" ")}`);
    }
  });

  it("treats March 12 and Mar 12 as the same date", () => {
    assert.deepEqual(extractFacts("due March 12"), extractFacts("due Mar 12"));
  });
});

describe("rewrite guard", () => {
  it("accepts a restyle that keeps every fact", () => {
    const rewrite =
      "Hi Sam — I'm free 09:00–09:40 today and have J-1042 in front of me. The draft total is $38,450; expect my note by 12:15 on March 12. Crew notes: #job-j1042.";
    const result = guardRewrite(DRAFT, rewrite);
    assert.equal(result.accepted, true, result.reason);
    assert.equal(result.text, rewrite);
  });

  it("rejects a rewrite that changes a time", () => {
    const result = guardRewrite(DRAFT, DRAFT.replace("09:40", "10:00"));
    assert.equal(result.accepted, false);
    assert.equal(result.text, DRAFT);
    assert.match(result.reason!, /dropped 09:40/);
    assert.match(result.reason!, /added 10:00/);
  });

  it("rejects a rewrite that invents a price", () => {
    const result = guardRewrite(DRAFT, `${DRAFT} We can likely do it for $35,000.`);
    assert.equal(result.accepted, false);
    assert.match(result.reason!, /added \$35,000/);
  });

  it("rejects a rewrite that drops the job id", () => {
    assert.equal(guardRewrite(DRAFT, DRAFT.replace("J-1042", "your job")).accepted, false);
  });

  it("rejects runaway length and empty output", () => {
    assert.equal(guardRewrite(DRAFT, DRAFT + " ".padEnd(400, "x")).reason, "rewrite grew too long");
    assert.equal(guardRewrite(DRAFT, "   ").reason, "empty rewrite");
  });
});

describe("guarded model", () => {
  const input = { kind: "email" as const, draft: DRAFT, facts: [] };

  it("passes a faithful rewrite through and logs it", async () => {
    const model = guarded({ name: "fake", polish: async () => DRAFT.replace("Sam,", "Hi Sam,") });
    assert.equal(await model.polish(input), DRAFT.replace("Sam,", "Hi Sam,"));
    assert.deepEqual(model.log, [{ kind: "email", accepted: true, reason: undefined }]);
  });

  it("falls back to the draft when the model changes a fact", async () => {
    const model = guarded({ name: "fake", polish: async () => DRAFT.replace("$38,450", "$34,000") });
    assert.equal(await model.polish(input), DRAFT);
    assert.equal(model.log[0]!.accepted, false);
  });

  it("falls back to the draft when the model throws", async () => {
    const model = guarded({ name: "fake", polish: async () => { throw new Error("timeout"); } });
    assert.equal(await model.polish(input), DRAFT);
    assert.equal(model.log[0]!.reason, "model call failed");
  });
});
