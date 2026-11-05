import { pathToFileURL } from "node:url";

import { runWorkflow } from "./orchestrator/supervisor.js";
import { resolveModel } from "./providers/model.js";
import { renderBrief, renderPlan, renderTraceJson, renderWarRoom, type RenderOptions } from "./render/terminal.js";

const HELP = `Quorum — agentic workflows for a day that fights back

Usage
  npm run demo            War room. Escalation at 08:47, swarm rewrites the day.
  npm run demo:plan       Day planner. Show the conflict, the rejected plan, the fix.
  npm run demo:brief      Morning brief for the same Tuesday, before the escalation.
  npm run demo:trace      War room as JSON.
  npm run demo:all        Plan, brief, then war room.
  npm run demo:live       Same as demo, but polish prose if a provider is configured.

Mock mode is the default. Pass --live with QUORUM_PROVIDER=openai and
OPENAI_API_KEY to restyle prose. The schedule never goes through a model.
`;

export async function main(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const live = argv.includes("--live");
  const command = argv.find((arg) => !arg.startsWith("-")) ?? "war-room";
  const model = resolveModel(live);
  const options: RenderOptions = { color: process.stdout.isTTY === true && !process.env.NO_COLOR };

  if (live && model.name === "mock") {
    process.stderr.write(
      "Live prose polish is off. Set QUORUM_PROVIDER=openai and OPENAI_API_KEY, then pass --live. Running mock.\n",
    );
  }

  switch (command) {
    case "war-room": {
      const state = await runWorkflow({ workflow: "war-room", model });
      process.stdout.write(`${renderWarRoom(state, options)}\n`);
      return state.status === "approved" ? 0 : 1;
    }
    case "plan": {
      const state = await runWorkflow({ workflow: "morning", model });
      process.stdout.write(`${renderPlan(state, options)}\n`);
      return state.status === "approved" ? 0 : 1;
    }
    case "brief": {
      const state = await runWorkflow({ workflow: "morning", model });
      process.stdout.write(`${renderBrief(state, options)}\n`);
      return state.status === "approved" ? 0 : 1;
    }
    case "trace": {
      const state = await runWorkflow({ workflow: "war-room", model });
      process.stdout.write(`${renderTraceJson(state)}\n`);
      return state.status === "approved" ? 0 : 1;
    }
    case "all": {
      const morning = await runWorkflow({ workflow: "morning", model });
      const war = await runWorkflow({ workflow: "war-room", model });
      process.stdout.write(`${renderPlan(morning, options)}\n`);
      process.stdout.write(`${renderBrief(morning, options)}\n`);
      process.stdout.write(`${renderWarRoom(war, options)}\n`);
      return morning.status === "approved" && war.status === "approved" ? 0 : 1;
    }
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
      return 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
