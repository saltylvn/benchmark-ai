import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildSnapshot } from "../src/export/snapshot.js";

describe("dashboard snapshot", () => {
  it("matches what the agent team produces today", async () => {
    const committed = JSON.parse(readFileSync("dashboard/data/snapshot.json", "utf8"));
    const fresh = JSON.parse(JSON.stringify(await buildSnapshot()));
    assert.deepEqual(
      committed,
      fresh,
      "dashboard/data/snapshot.json is stale. Run `npm run export:dashboard` and commit it.",
    );
  });
});
