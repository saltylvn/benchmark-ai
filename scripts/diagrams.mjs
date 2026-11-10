import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const OUT = new URL("../docs/images/", import.meta.url);

const SANS = `"Liberation Sans", "Segoe UI", system-ui, sans-serif`;
const SERIF = `Georgia, "Liberation Serif", Palatino, serif`;

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function architecture() {
  const width = 1600;
  const height = 1360;
  const cards = [];
  const arrows = [];

  function add(svg) {
    cards.push(svg);
  }

  function arrow(x1, y1, x2, y2) {
    arrows.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#221f1a" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    );
  }

  function card(x, y, w, h, spec) {
    const fill = spec.fill ?? "#fffdf9";
    const stroke = spec.stroke ?? "#d2c8b8";
    const dash = spec.dashed ? ` stroke-dasharray="7 5"` : "";
    const titleFill = spec.titleFill ?? "#221f1a";
    const bodyFill = spec.bodyFill ?? "#3a342c";
    const kickerFill = spec.kickerFill ?? "#5c564c";
    const lines = spec.lines ?? [];
    add(`<g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>
      ${spec.kicker ? `<text x="${x + 16}" y="${y + 24}" fill="${kickerFill}" font-size="12" font-weight="700" letter-spacing="0.08em">${esc(spec.kicker)}</text>` : ""}
      <text x="${x + 16}" y="${y + (spec.kicker ? 50 : 36)}" fill="${titleFill}" font-size="20" font-weight="700">${esc(spec.title)}</text>
      ${lines
        .map(
          (line, index) =>
            `<text x="${x + 16}" y="${y + (spec.kicker ? 76 : 62) + index * 22}" fill="${bodyFill}" font-size="15">${esc(line)}</text>`,
        )
        .join("")}
    </g>`);
  }

  const x0 = 48;
  const gap = 16;
  const ySources = 200;
  const sourceH = 132;
  const fixtureW = 250;
  const fixtures = [
    ["FIXTURE", "Inbox", ["Sam Rivera, 08:47", "Kitchen, 123 Example Ln"]],
    ["FIXTURE", "Thursday calendar", ["12 March 2026", "Bright Spark overlaps 09:00"]],
    ["FIXTURE", "Job file", ["J-1042 and two partners", "Facts, questions, limits"]],
  ];
  fixtures.forEach((item, index) => {
    card(x0 + index * (fixtureW + gap), ySources, fixtureW, sourceH, {
      kicker: item[0],
      title: item[1],
      lines: item[2],
    });
  });
  const integX = x0 + 3 * (fixtureW + gap);
  const integW = width - x0 - integX;
  add(`<rect x="${integX}" y="${ySources}" width="${integW}" height="${sourceH}" rx="12" fill="#fffdf9" stroke="#8a4e0c" stroke-width="1.5" stroke-dasharray="7 5"/>
    <text x="${integX + 18}" y="${ySources + 26}" fill="#8a4e0c" font-size="12" font-weight="700" letter-spacing="0.08em">ON THE PAGE, NOT CALLED</text>
    <text x="${integX + 18}" y="${ySources + 54}" fill="#221f1a" font-size="18" font-weight="700">HubSpot</text>
    <text x="${integX + 130}" y="${ySources + 54}" fill="#3a342c" font-size="15">Job context. No client in this repo.</text>
    <text x="${integX + 18}" y="${ySources + 82}" fill="#221f1a" font-size="18" font-weight="700">Google Calendar</text>
    <text x="${integX + 196}" y="${ySources + 82}" fill="#3a342c" font-size="15">The day. The run reads the fixture.</text>
    <text x="${integX + 18}" y="${ySources + 110}" fill="#221f1a" font-size="18" font-weight="700">Slack</text>
    <text x="${integX + 80}" y="${ySources + 110}" fill="#3a342c" font-size="15">#job-j1042. The note is not posted.</text>`);

  const fixtureCenter = x0 + (3 * fixtureW + 2 * gap) / 2;
  arrow(fixtureCenter, ySources + sourceH, fixtureCenter, ySources + sourceH + 36);

  const yTools = 392;
  const half = (width - x0 * 2 - gap) / 2;
  const toolH = 120;
  card(x0, yTools, half, toolH, {
    kicker: "TOOLS",
    title: "Read-only toolkit",
    lines: ["listEvents, listInbox, lookupAccount, accountsOnCalendar.", "Intake reads through these. They write nothing."],
  });
  card(x0 + half + gap, yTools, half, toolH, {
    kicker: "MODEL",
    title: "Prose model",
    lines: ["Mock returns the draft. It is the default.", "OpenAI polishes wording only, and only with --live."],
  });
  arrow(width / 2, yTools + toolH, width / 2, yTools + toolH + 36);

  const yOrch = 572;
  const orchH = 148;
  const supW = 500;
  card(x0, yOrch, supW, orchH, {
    kicker: "LEAD",
    title: "Supervisor",
    lines: [
      "The only router. Specialists never call each other.",
      "Stops when the plan is approved, or after three tries.",
      "If nothing passes, status is needs_human.",
    ],
    fill: "#2c3d86",
    stroke: "#2c3d86",
    titleFill: "#fffdf9",
    bodyFill: "#e7ebf6",
    kickerFill: "#c9d2f2",
  });
  card(x0 + supW + gap, yOrch, width - x0 * 2 - supW - gap, orchH, {
    kicker: "SHARED MEMORY",
    title: "RunState, the board",
    lines: [
      "findings, research, attempts, critiques, actions, brief, trace.",
      "Handoffs are written here. Agents do not call one another.",
    ],
  });
  arrow(width / 2, yOrch + orchH, width / 2, yOrch + orchH + 36);

  const ySpec = 780;
  const specH = 156;
  const specW = (width - x0 * 2 - gap * 3) / 4;
  const specialists = [
    ["INTAKE", "Intake", ["Calendar, inbox, and the job file.", "intake.ts and researcher.ts.", "Does not propose a day."]],
    ["SCHEDULING", "Scheduling", ["One proposal each revision.", "planner.ts. Calls early, then morning.", "Hands the plan to the critic."]],
    ["DRAFTING", "Drafting", ["Runs only after approval.", "executor.ts writes the drafts.", "Calendar, email, and Slack."]],
    ["BRIEFING", "Briefing", ["Three outcomes, one call card.", "briefWriter.ts.", "Adds no new promise."]],
  ];
  specialists.forEach((item, index) => {
    card(x0 + index * (specW + gap), ySpec, specW, specH, {
      kicker: item[0],
      title: item[1],
      lines: item[2],
    });
  });

  const schedLeft = x0 + specW + gap;
  const schedX = schedLeft + specW / 2;
  const yCritic = ySpec + specH + 44;
  arrow(schedX, ySpec + specH, schedX, yCritic);
  card(schedLeft, yCritic, specW, 142, {
    kicker: "CHECKLIST",
    title: "Critic",
    lines: ["Scores the plan. Does not edit it.", "Rejection goes back to Scheduling.", "Cap of three. critic.ts."],
    stroke: "#9b2832",
    kickerFill: "#9b2832",
  });
  const returnX = schedLeft + 22;
  arrows.push(
    `<path d="M ${returnX} ${yCritic} V ${ySpec + specH}" fill="none" stroke="#9b2832" stroke-width="1.5" marker-end="url(#arrow-red)"/>`,
  );
  arrows.push(
    `<text x="${returnX - 8}" y="${ySpec + specH + 28}" text-anchor="end" font-size="12" font-weight="700" fill="#9b2832">if rejected</text>`,
  );

  const yOut = yCritic + 142 + 56;
  const outH = 112;
  const compX = x0 + 2 * (specW + gap) + specW / 2;
  arrow(compX, ySpec + specH, compX, yOut);
  card(x0, yOut, supW, outH, {
    kicker: "HUMAN GATE",
    title: "Maria approves",
    lines: ["Price, dates, and notes a homeowner", "would see. The run does not send."],
    stroke: "#9b2832",
    kickerFill: "#9b2832",
  });
  card(x0 + supW + gap, yOut, width - x0 * 2 - supW - gap, outH, {
    kicker: "OUTPUTS",
    title: "Drafts stay in the process",
    lines: [
      "calendar.create, calendar.update, email.draft, slack.draft, brief.",
      "Every action has status draft. There is no send path.",
    ],
    fill: "#e7f4ee",
    stroke: "#1b754e",
    kickerFill: "#1b754e",
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Benchmark architecture</title>
  <desc id="desc">Layered architecture of the Benchmark demo: fixture inputs, page-only integration points, a read-only toolkit, a mock prose model, the supervisor and shared RunState, four specialists, the critic revision loop, Maria's approval, and unsent drafts.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1.2 L 8.5 5 L 0 8.8 Z" fill="#221f1a"/>
    </marker>
    <marker id="arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1.2 L 8.5 5 L 0 8.8 Z" fill="#9b2832"/>
    </marker>
  </defs>
  <style>
    text { font-family: ${SANS}; }
    .serif { font-family: ${SERIF}; }
  </style>
  <rect width="${width}" height="${height}" fill="#f3f0e8"/>
  <text x="48" y="46" class="serif" font-size="34" fill="#221f1a">Benchmark architecture</text>
  <text x="48" y="78" font-size="16" fill="#3a342c">One lead and four specialists. Mock mode. The schedule never goes through a model.</text>
  <g aria-label="Legend">
    <rect x="48" y="96" width="1504" height="44" rx="12" fill="#fffdf9" stroke="#d2c8b8"/>
    <line x1="68" y1="118" x2="104" y2="118" stroke="#221f1a" stroke-width="1.5" marker-end="url(#arrow)"/>
    <text x="112" y="123" font-size="14" fill="#221f1a">Moves in this demo</text>
    <rect x="280" y="108" width="36" height="20" rx="4" fill="#fffdf9" stroke="#8a4e0c" stroke-dasharray="4 3"/>
    <text x="324" y="123" font-size="14" fill="#221f1a">Dashed border: named, not called</text>
    <rect x="620" y="108" width="18" height="18" rx="3" fill="#2c3d86"/>
    <text x="646" y="123" font-size="14" fill="#221f1a">Lead</text>
    <rect x="720" y="108" width="18" height="18" rx="3" fill="#fffdf9" stroke="#9b2832"/>
    <text x="746" y="123" font-size="14" fill="#221f1a">Critic or human gate</text>
    <rect x="960" y="108" width="18" height="18" rx="3" fill="#e7f4ee" stroke="#1b754e"/>
    <text x="986" y="123" font-size="14" fill="#221f1a">Unsent draft</text>
  </g>
  <text x="48" y="184" font-size="13" font-weight="700" letter-spacing="0.08em" fill="#5c564c">1  SOURCES</text>
  <text x="48" y="376" font-size="13" font-weight="700" letter-spacing="0.08em" fill="#5c564c">2  TOOLS AND MODEL</text>
  <text x="48" y="556" font-size="13" font-weight="700" letter-spacing="0.08em" fill="#5c564c">3  ORCHESTRATION</text>
  <text x="48" y="764" font-size="13" font-weight="700" letter-spacing="0.08em" fill="#5c564c">4  SPECIALISTS</text>
  <text x="48" y="${yOut - 28}" font-size="13" font-weight="700" letter-spacing="0.08em" fill="#5c564c">5  HUMAN GATE AND OUTPUTS</text>
  ${arrows.join("\n")}
  ${cards.join("\n")}
</svg>`;
}

function icon(kind, x, y, color) {
  const plate = `<rect x="${x}" y="${y}" width="48" height="48" rx="12" fill="${color === "#fffdf9" ? "#24336f" : "#e7ebf6"}"/>`;
  const stroke = color;
  const shapes = {
    supervisor: `<circle cx="${x + 24}" cy="${y + 16}" r="4" fill="${stroke}"/>
      <circle cx="${x + 12}" cy="${y + 34}" r="3.5" fill="${stroke}"/>
      <circle cx="${x + 36}" cy="${y + 34}" r="3.5" fill="${stroke}"/>
      <path d="M ${x + 24} ${y + 20} L ${x + 14} ${y + 31} M ${x + 24} ${y + 20} L ${x + 34} ${y + 31}" stroke="${stroke}" stroke-width="1.6" fill="none"/>`,
    intake: `<path d="M ${x + 14} ${y + 18} H ${x + 34} V ${y + 34} H ${x + 14} Z" fill="none" stroke="${stroke}" stroke-width="1.6"/>
      <path d="M ${x + 14} ${y + 18} L ${x + 24} ${y + 26} L ${x + 34} ${y + 18}" fill="none" stroke="${stroke}" stroke-width="1.6"/>`,
    scheduling: `<rect x="${x + 14}" y="${y + 16}" width="20" height="18" rx="2" fill="none" stroke="${stroke}" stroke-width="1.6"/>
      <path d="M ${x + 14} ${y + 22} H ${x + 34} M ${x + 20} ${y + 14} V ${y + 19} M ${x + 28} ${y + 14} V ${y + 19}" stroke="${stroke}" stroke-width="1.6" fill="none"/>`,
    compliance: `<path d="M ${x + 16} ${y + 14} H ${x + 29} L ${x + 34} ${y + 19} V ${y + 34} H ${x + 16} Z" fill="none" stroke="${stroke}" stroke-width="1.6"/>
      <path d="M ${x + 20} ${y + 25} H ${x + 30} M ${x + 20} ${y + 30} H ${x + 27}" stroke="${stroke}" stroke-width="1.6" fill="none"/>`,
    briefing: `<path d="M ${x + 15} ${y + 18} H ${x + 33} M ${x + 15} ${y + 24} H ${x + 29} M ${x + 15} ${y + 30} H ${x + 25}" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`,
  };
  return `<g>${plate}${shapes[kind]}</g>`;
}

function field(x, y, label, lines, labelFill = "#5c564c", textFill = "#3a342c") {
  return `<text x="${x}" y="${y}" fill="${labelFill}" font-size="12" font-weight="700" letter-spacing="0.08em">${esc(label)}</text>
    <text x="${x}" y="${y + 24}" fill="${textFill}" font-size="15">${esc(lines[0])}</text>
    <text x="${x}" y="${y + 46}" fill="${textFill}" font-size="15">${esc(lines[1])}</text>`;
}

function agents() {
  const width = 1600;
  const height = 1080;
  const x0 = 48;
  const gap = 20;
  const leadY = 124;
  const leadH = 220;
  const leadW = width - x0 * 2;
  const fieldX = x0 + 28;
  const fieldW = 370;
  const specW = (leadW - gap) / 2;
  const specH = 312;
  const specY = leadY + leadH + 24;
  const specialists = [
    {
      kind: "intake",
      name: "Intake",
      role: "Reads the day and the job file. Does not propose a schedule.",
      file: "intake.ts and researcher.ts",
      inputs: ["Calendar events and the inbox", "Sam's email, once it arrives"],
      outputs: ["Findings: overlap and deadlines", "Notes: facts, questions, limits"],
      tools: ["listEvents and listInbox", "lookupAccount, accountsOnCalendar"],
      handoff: ["Scheduling", "After the job lookup finishes"],
    },
    {
      kind: "scheduling",
      name: "Scheduling",
      role: "Proposes one day. Calls early first, then the morning.",
      file: "planner.ts and schedule/plan.ts",
      inputs: ["Findings and the job facts", "Critic failure codes, if any"],
      outputs: ["One plan, stored on attempts", "client-first or protect-focus"],
      tools: ["No toolkit and no model", "planSchedule is a pure function"],
      handoff: ["The critic, through the supervisor", "A rejection comes back here"],
    },
    {
      kind: "compliance",
      name: "Drafting",
      role: "Turns an approved plan into drafts. Never sends.",
      file: "executor.ts and schedule/actions.ts",
      inputs: ["The approved plan only", "Events, jobs, and the deadline"],
      outputs: ["Calendar, email, and Slack drafts", "Every action has status draft"],
      tools: ["No live calendar, mail, or Slack", "Prose model, optional, for wording"],
      handoff: ["Briefing", "Drafts stay on the board"],
    },
    {
      kind: "briefing",
      name: "Briefing",
      role: "Writes three outcomes and a call card. Adds no promise.",
      file: "briefWriter.ts",
      inputs: ["The approved plan", "The research notes"],
      outputs: ["Headline, outcomes, and watchouts", "Call card: ask, and do not promise"],
      tools: ["No schedule function", "Prose model, optional, for the headline"],
      handoff: ["No further specialist", "The supervisor then closes"],
    },
  ];

  const leadFields = [
    ["INPUTS", ["Thursday fixture and the goal", "The critic score, once it exists"]],
    ["OUTPUTS", ["The trace and the run status", "approved, or needs_human"]],
    ["TOOLS", ["None of its own", "It passes the read-only toolkit in"]],
    ["HANDS OFF TO", ["Intake, to open the day", "Then Scheduling or Drafting"]],
  ]
    .map((item, index) => field(fieldX + index * fieldW, leadY + 132, item[0], item[1], "#c9d2f2", "#e7ebf6"))
    .join("");

  const specCards = specialists
    .map((agent, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = x0 + col * (specW + gap);
      const y = specY + row * (specH + gap);
      const fields = [
        ["INPUTS", agent.inputs],
        ["OUTPUTS", agent.outputs],
        ["TOOLS", agent.tools],
        ["HANDS OFF TO", agent.handoff],
      ]
        .map((item, fieldIndex) => {
          const fx = x + 24 + (fieldIndex % 2) * 360;
          const fy = y + 132 + Math.floor(fieldIndex / 2) * 104;
          return field(fx, fy, item[0], item[1]);
        })
        .join("");
      return `<g>
        <rect x="${x}" y="${y}" width="${specW}" height="${specH}" rx="14" fill="#fffdf9" stroke="#d2c8b8" stroke-width="1.5"/>
        ${icon(agent.kind, x + 24, y + 24, "#2c3d86")}
        <text x="${x + 88}" y="${y + 46}" fill="#221f1a" font-size="26" font-weight="700">${esc(agent.name)}</text>
        <text x="${x + 88}" y="${y + 72}" fill="#3a342c" font-size="15">${esc(agent.role)}</text>
        <text x="${x + 24}" y="${y + 112}" fill="#5c564c" font-size="13">${esc(agent.file)}</text>
        ${fields}
      </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Benchmark agents</title>
  <desc id="desc">Cards for the Benchmark supervisor and the four specialists Intake, Scheduling, Drafting, and Briefing. Each card lists the role, inputs, outputs, tools, and hand-off from the source.</desc>
  <style>text { font-family: ${SANS}; } .serif { font-family: ${SERIF}; }</style>
  <rect width="${width}" height="${height}" fill="#f3f0e8"/>
  <text x="48" y="52" class="serif" font-size="34" fill="#221f1a">Meet the agents</text>
  <text x="48" y="84" font-size="16" fill="#3a342c">One lead and four specialists. They do not call each other. The critic is the lead's checklist, not a fifth agent.</text>
  <g>
    <rect x="${x0}" y="${leadY}" width="${leadW}" height="${leadH}" rx="14" fill="#2c3d86"/>
    ${icon("supervisor", x0 + 24, leadY + 24, "#fffdf9")}
    <text x="${x0 + 88}" y="${leadY + 46}" fill="#fffdf9" font-size="26" font-weight="700">Supervisor</text>
    <text x="${x0 + 88}" y="${leadY + 72}" fill="#e7ebf6" font-size="15">Routes one specialist at a time. Stops at approval, or after three revisions.</text>
    <text x="${x0 + 88}" y="${leadY + 96}" fill="#c9d2f2" font-size="13">orchestrator/supervisor.ts, and critic.ts for the score</text>
    ${leadFields}
  </g>
  ${specCards}
</svg>`;
}

function workflow() {
  const width = 1640;
  const height = 900;
  const lanes = [
    "Sam Rivera",
    "Supervisor",
    "Intake",
    "Scheduling",
    "Drafting",
    "Briefing",
    "Maria Alvarez",
  ];
  const gutter = 200;
  const top = 168;
  const laneH = 86;
  const cols = 8;
  const colW = (width - gutter - 36) / cols;
  const steps = [
    { col: 0, lane: 0, title: "08:47 email", body: "Kitchen quote today", tone: "amber" },
    { col: 0, lane: 1, title: "Thursday is open", body: "Routes to Intake", tone: "blue" },
    { col: 1, lane: 2, title: "Reads the day", body: "Overlap and J-1042", tone: "paper" },
    { col: 2, lane: 3, title: "Revision 1", body: "Estimate at 13:30", tone: "paper" },
    { col: 3, lane: 1, title: "Critic 75/100", body: "FOCUS_BLOCK", tone: "red" },
    { col: 4, lane: 3, title: "Revision 2", body: "Estimate 09:40–11:20", tone: "paper" },
    { col: 5, lane: 1, title: "Critic 100/100", body: "Morning holds", tone: "green" },
    { col: 6, lane: 4, title: "Eight drafts", body: "Nothing sent", tone: "green" },
    { col: 6, lane: 5, title: "Call card", body: "No new promises", tone: "green" },
    { col: 7, lane: 6, title: "Not sent", body: "Maria approves first", tone: "ink" },
  ];
  const tones = {
    paper: { fill: "#fffdf9", stroke: "#d2c8b8", title: "#221f1a" },
    blue: { fill: "#2c3d86", stroke: "#2c3d86", title: "#fffdf9", body: "#e7ebf6" },
    red: { fill: "#fffdf9", stroke: "#9b2832", title: "#9b2832" },
    green: { fill: "#e7f4ee", stroke: "#1b754e", title: "#145c3c" },
    amber: { fill: "#f8efe3", stroke: "#8a4e0c", title: "#6d3c09" },
    ink: { fill: "#fffdf9", stroke: "#221f1a", title: "#221f1a" },
  };
  const headers = ["Request", "Read", "First plan", "Rejected", "Second plan", "Approved", "Drafts", "Gate"];

  function box(step) {
    const x = gutter + step.col * colW + 10;
    const y = top + step.lane * laneH + 14;
    const w = colW - 20;
    const h = 58;
    return { ...step, x, y, w, h };
  }
  const boxes = steps.map(box);
  const links = [
    [0, 1, ""],
    [1, 2, ""],
    [2, 3, ""],
    [3, 4, ""],
    [4, 5, "protect-focus"],
    [5, 6, ""],
    [6, 7, ""],
    [7, 8, ""],
    [8, 9, ""],
  ];

  function anchor(from, to) {
    const sameCol = from.col === to.col;
    if (sameCol) {
      return {
        x1: from.x + from.w / 2,
        y1: from.y + from.h,
        x2: to.x + to.w / 2,
        y2: to.y,
        path: `M ${from.x + from.w / 2} ${from.y + from.h + 2} V ${to.y - 2}`,
      };
    }
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    const mid = (x1 + x2) / 2;
    return {
      x1,
      y1,
      x2,
      y2,
      path: `M ${x1 + 2} ${y1} H ${mid} V ${y2} H ${x2 - 2}`,
    };
  }

  const arrows = links
    .map(([fromIndex, toIndex, label]) => {
      const from = boxes[fromIndex];
      const to = boxes[toIndex];
      const line = anchor(from, to);
      const labelX = (from.x + from.w + to.x) / 2;
      const labelY = to.y - 22;
      return `<path d="${line.path}" fill="none" stroke="#221f1a" stroke-width="1.5" marker-end="url(#arrow)"/>
        ${
          label
            ? `<rect x="${labelX - 58}" y="${labelY - 14}" width="116" height="18" rx="6" fill="#fbeeee"/>
               <text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="12" font-weight="700" fill="#9b2832">${esc(label)}</text>`
            : ""
        }`;
    })
    .join("\n");

  const bands = lanes
    .map((name, index) => {
      const y = top + index * laneH;
      const fill = index % 2 === 0 ? "#fffdf9" : "#efeae2";
      return `<rect x="32" y="${y}" width="${width - 64}" height="${laneH}" fill="${fill}"/>
        <text x="48" y="${y + laneH / 2 + 5}" font-size="15" font-weight="700" fill="#221f1a">${esc(name)}</text>`;
    })
    .join("\n");

  const heads = headers
    .map((label, index) => {
      const x = gutter + index * colW + colW / 2;
      return `<text x="${x}" y="148" text-anchor="middle" font-size="13" font-weight="700" letter-spacing="0.04em" fill="#5c564c">${esc(label.toUpperCase())}</text>`;
    })
    .join("\n");

  const nodes = boxes
    .map((item) => {
      const tone = tones[item.tone];
      const body = tone.body ?? "#3a342c";
      return `<g>
        <rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" rx="10" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="1.5"/>
        <text x="${item.x + 12}" y="${item.y + 24}" font-size="15" font-weight="700" fill="${tone.title}">${esc(item.title)}</text>
        <text x="${item.x + 12}" y="${item.y + 44}" font-size="13" fill="${body}">${esc(item.body)}</text>
      </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Benchmark Thursday workflow</title>
  <desc id="desc">Swimlane of Maria Alvarez's Thursday at Summit Ridge Builders. Sam Rivera's kitchen request is read by Intake, scheduled twice after the critic rejects the first plan, and turned into unsent drafts for Maria to approve.</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 1.2 L 8.5 5 L 0 8.8 Z" fill="#221f1a"/>
    </marker>
  </defs>
  <style>text { font-family: ${SANS}; } .serif { font-family: ${SERIF}; }</style>
  <rect width="${width}" height="${height}" fill="#f3f0e8"/>
  <text x="48" y="52" class="serif" font-size="34" fill="#221f1a">Thursday, from request to drafts</text>
  <text x="48" y="82" font-size="16" fill="#3a342c">Maria Alvarez, Summit Ridge Builders. Sam Rivera wants a kitchen quote. Mock mode. Nothing is sent.</text>
  <text x="48" y="112" font-size="14" fill="#3a342c">Bright Spark moves to 13:45 on the approved day. Dave and the Pinecrest 15:30 window stay put. The site walk stays at 13:00.</text>
  ${bands}
  ${heads}
  ${arrows}
  ${nodes}
  <text x="48" y="860" font-size="14" fill="#3a342c">The critic is the lead's checklist, not a fifth specialist. This Thursday ends on revision 2. The supervisor would stop after three.</text>
  <text x="48" y="884" font-size="14" fill="#3a342c">Red is the critic's rejection. The last card is Maria's gate. Drafts are calendar changes, an email, a Slack note, and the call card.</text>
</svg>`;
}

async function renderPngs() {
  const version = await fetch("http://127.0.0.1:9222/json/version").then((response) => response.json());
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });
  function send(method, params = {}, sessionId) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, (message) => {
        if (message.error) reject(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
    });
  }
  const target = await send("Target.createTarget", { url: "about:blank" });
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const call = (method, params) => send(method, params, sessionId);
  await call("Page.enable");
  for (const name of ["architecture", "workflow", "agents"]) {
    const svg = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL(`${name}.svg`, OUT), "utf8"),
    );
    const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const width = Number(match?.[1] ?? 1600);
    const height = Number(match?.[2] ?? 1000);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f3f0e8}</style></head><body>${svg}</body></html>`;
    writeFileSync(`/tmp/${name}.html`, html);
    await call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await call("Page.navigate", { url: `file:///tmp/${name}.html` });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const image = await call("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(image.data, "base64"));
    console.log("rendered", name, width, height);
  }
  await send("Target.closeTarget", { targetId: target.targetId });
  ws.close();
}

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL("architecture.svg", OUT), architecture());
writeFileSync(new URL("workflow.svg", OUT), workflow());
writeFileSync(new URL("agents.svg", OUT), agents());
console.log("wrote svg");

if (!process.argv.includes("--svg-only")) {
  const chromeUp = await fetch("http://127.0.0.1:9222/json/version").then(
    () => true,
    () => false,
  );
  if (!chromeUp) {
    const chrome = spawn(
      "google-chrome",
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--remote-debugging-port=9222",
        "--user-data-dir=/tmp/chrome-bench",
        "about:blank",
      ],
      { stdio: "ignore", detached: true },
    );
    chrome.unref();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const up = await fetch("http://127.0.0.1:9222/json/version").then(
        () => true,
        () => false,
      );
      if (up) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  await renderPngs();
}
