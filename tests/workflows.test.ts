import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

import { runWorkflow } from "../src/orchestrator/supervisor.js";
import { resolveModel } from "../src/providers/model.js";
import { range } from "../src/time.js";

const mock = resolveModel(false);

describe("war room", () => {
  it("rejects the greedy morning, then approves a rewrite", async () => {
    const state = await runWorkflow({ workflow: "war-room", model: mock });
    assert.equal(state.status, "approved");
    assert.equal(state.modelName, "mock");
    assert.equal(state.critiques.length, 2);
    assert.equal(state.critiques[0]?.approved, false);
    assert.equal(state.critiques[0]?.strategy, "client-first");
    assert.equal(state.critiques[0]?.failures[0]?.code, "FOCUS_BLOCK");
    assert.equal(state.critiques[1]?.approved, true);
    assert.equal(state.critiques[1]?.strategy, "protect-focus");

    const focus = state.plan?.blocks.find((block) => block.id === "focus");
    const meridian = state.plan?.blocks.find((block) => block.id === "meridian");
    assert.ok(focus && meridian);
    assert.equal(range(focus.start, focus.end), "09:40–11:20");
    assert.ok(meridian.end <= 13 * 60);

    const email = state.actions.find((action) => action.type === "email.draft");
    const slack = state.actions.find((action) => action.type === "slack.draft");
    assert.ok(email && email.type === "email.draft");
    assert.equal(email.status, "draft");
    assert.match(email.body, /12:15/);
    assert.match(email.body, /J-1042/);
    assert.ok(slack && slack.type === "slack.draft");
    assert.equal(slack.channel, "#job-j1042");
    assert.match(slack.text, /Nothing has been sent/);
    assert.equal(state.brief?.callCard?.account, "Rivera Kitchen");
    assert.ok(state.trace.some((event) => event.handoff?.to === "planner"));
    for (const event of state.trace) {
      const seconds = Number(event.at.slice(-2));
      assert.ok(seconds >= 0 && seconds < 60, event.at);
    }
    assert.ok(state.actions.every((action) => action.status === "draft"));
  });
});

describe("morning", () => {
  it("gives the focus block back and does not invent an escalation", async () => {
    const state = await runWorkflow({ workflow: "morning", model: mock });
    assert.equal(state.status, "approved");
    assert.equal(state.inbox.length, 0);
    assert.equal(state.actions.some((action) => action.type === "email.draft"), false);
    const focus = state.plan?.blocks.find((block) => block.id === "focus");
    assert.equal(focus && range(focus.start, focus.end), "09:00–11:00");
    assert.match(state.brief?.headline ?? "", /09:00–11:00/);
    assert.ok(state.actions.some((action) => action.type === "calendar.update" && action.id === "northwind"));
  });
});

describe("cli", () => {
  it("runs the hero demo in mock mode", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "war-room"], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ATLAS_PROVIDER: "mock" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Rivera/);
    assert.match(result.stdout, /protect-focus/);
    assert.match(result.stdout, /nothing sent/i);
    assert.doesNotMatch(result.stdout, /sk-[a-zA-Z0-9]{8,}/);
  });
});
