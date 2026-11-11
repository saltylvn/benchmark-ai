import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Cross-language contract: a webhook signed by the Python service
 * (dashboard/automation.py) must verify in the n8n template's own JavaScript.
 */
const require = createRequire(import.meta.url);
const fixture = JSON.parse(readFileSync(new URL("../integrations/fixtures/approval-recorded.json", import.meta.url), "utf8"));
const workflow = JSON.parse(readFileSync(new URL("../integrations/n8n/approvals-to-sheets.json", import.meta.url), "utf8"));
const code: string = workflow.nodes.find((n: { type: string }) => n.type === "n8n-nodes-base.code").parameters.jsCode;

type Item = { json: Record<string, unknown> };
function runTemplate(headers: Record<string, string>, body: unknown, now: number): Item[] {
  const source = code.replace("PASTE_WEBHOOK_SECRET_FROM_RENDER", fixture.secret);
  const realNow = Date.now;
  Date.now = () => now * 1000;
  try {
    const $input = { all: () => [{ json: { headers, body } }] };
    return new Function("$input", "require", source)($input, require) as Item[];
  } finally {
    Date.now = realNow;
  }
}

const headers = { "x-benchmark-timestamp": String(fixture.timestamp), "x-benchmark-signature": fixture.signature };

describe("webhook signatures across Python and JavaScript", () => {
  it("rebuilds the exact signed bytes from the parsed body", () => {
    assert.equal(JSON.stringify(JSON.parse(fixture.body)), fixture.body);
  });

  it("verifies in the n8n template and shapes one sheet row", () => {
    const rows = runTemplate(headers, JSON.parse(fixture.body), fixture.timestamp + 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.json.approvedBy, "Renée Walsh");
    assert.equal(rows[0]!.json.item, "D6");
    assert.equal(rows[0]!.json.via, "api");
  });

  it("rejects a tampered body, a wrong signature, and a stale timestamp", () => {
    const body = JSON.parse(fixture.body);
    body.data.act = "skip";
    assert.throws(() => runTemplate(headers, body, fixture.timestamp + 10), /bad or stale/);
    assert.throws(() => runTemplate({ ...headers, "x-benchmark-signature": "sha256=00" }, JSON.parse(fixture.body), fixture.timestamp), /bad or stale/);
    assert.throws(() => runTemplate(headers, JSON.parse(fixture.body), fixture.timestamp + 3600), /bad or stale/);
  });
});
