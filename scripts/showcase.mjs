import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const OUT = new URL("../docs/images/showcase/", import.meta.url);
const SANS = `"Liberation Sans", "Segoe UI", system-ui, sans-serif`;
const SERIF = `Georgia, "Liberation Serif", Palatino, serif`;

const INK = "#221f1a";
const BODY = "#3a342c";
const MUTED = "#5c564c";
const LINE = "#d2c8b8";
const PAPER = "#fffdf9";
const BG = "#f3f0e8";
const BLUE = "#2c3d86";
const BLUE_SOFT = "#e7ebf6";
const RED = "#9b2832";
const RED_SOFT = "#fbeeee";
const GREEN = "#1b754e";
const GREEN_SOFT = "#e7f4ee";
const AMBER = "#8a4e0c";
const AMBER_SOFT = "#f8efe3";

function esc(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function shell({ title, desc, width, height, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${esc(title)}</title>
  <desc id="desc">${esc(desc)}</desc>
  <style>text { font-family: ${SANS}; } .serif { font-family: ${SERIF}; }</style>
  <rect width="${width}" height="${height}" fill="${BG}"/>
  ${body}
</svg>`;
}

function badge(x, y, label, tone) {
  const fill = tone === "planned" ? AMBER_SOFT : GREEN_SOFT;
  const stroke = tone === "planned" ? AMBER : GREEN;
  const width = label.length * 7.2 + 22;
  return `<rect x="${x}" y="${y}" width="${width}" height="22" rx="11" fill="${fill}" stroke="${stroke}"/>
    <text x="${x + 11}" y="${y + 15}" fill="${stroke}" font-size="12" font-weight="700">${esc(label)}</text>`;
}

const AGENTS = [
  {
    id: "supervisor",
    name: "Supervisor",
    file: "orchestrator/supervisor.ts and critic.ts",
    role: "The only router. Specialists do not call each other.",
    triggers: ["Thursday run, or the quiet morning", "A critic score comes back"],
    inputs: ["The fixture day and the goal", "Failure codes, up to three tries"],
    outputs: ["The trace and the run status", "approved, or needs_human"],
    tools: ["None of its own", "Passes the read-only toolkit to Intake"],
    handoff: ["Intake first", "Scheduling again, or Compliance at 100"],
    human: ["Stops for a person after three misses", "Maria still approves a send"],
  },
  {
    id: "intake",
    name: "Intake",
    file: "intake.ts and researcher.ts",
    role: "Reads the day and the job file. Does not propose a schedule.",
    triggers: ["Supervisor says start from the calendar", "An urgent email is on the board"],
    inputs: ["Calendar events and the inbox", "Job records for whoever is on the day"],
    outputs: ["Findings: overlap, deadlines, protected blocks", "Notes: facts, questions, limits"],
    tools: ["listEvents and listInbox", "lookupAccount and accountsOnCalendar"],
    handoff: ["Scheduling, after the job lookup", "No schedule is proposed here"],
    human: ["Does not set a price", "Does not promise a start date"],
  },
  {
    id: "scheduling",
    name: "Scheduling",
    file: "planner.ts and schedule/plan.ts",
    role: "Proposes one day. Calls early first, then holds the morning.",
    triggers: ["Job facts are on the board", "The critic names a failure"],
    inputs: ["Events, demands, and the last failure", "Fixed meetings stay fixed"],
    outputs: ["One plan stored on attempts", "client-first, or protect-focus"],
    tools: ["planSchedule, a pure function", "No model and no toolkit"],
    handoff: ["The critic, run by the supervisor", "A rejection comes back here"],
    human: ["Does not move Dave or the county window", "Does not send the calendar change"],
  },
  {
    id: "compliance",
    name: "Compliance",
    file: "executor.ts and schedule/actions.ts",
    role: "Turns an approved plan into drafts. Never sends.",
    triggers: ["The critic scores 100", "The supervisor marks the run approved"],
    inputs: ["The approved plan and the original events", "Jobs, the deadline, and Maria's name"],
    outputs: ["Calendar, email, and Slack drafts", "Every action has status draft"],
    tools: ["buildActions, in memory", "Optional prose model for wording only"],
    handoff: ["Briefing", "Drafts are already on the board"],
    human: ["There is no send path", "Maria approves before anything could leave"],
  },
  {
    id: "briefing",
    name: "Briefing",
    file: "briefWriter.ts",
    role: "Writes three outcomes and a call card. Adds no promise.",
    triggers: ["Drafts are on the board", "The plan is the approved one"],
    inputs: ["The approved plan", "Research notes and do-not-promise lines"],
    outputs: ["Headline, outcomes, and watchouts", "A call card for the kitchen call"],
    tools: ["Composition stays in code", "Optional prose model for the headline"],
    handoff: ["No further specialist", "The supervisor closes the run"],
    human: ["The card lists what not to promise", "Maria decides what Sam may hear"],
  },
];

function agentsHero() {
  const width = 1600;
  const cards = [
    ["Intake", "Reads the calendar, the inbox, and the job file.", "Hands off to Scheduling"],
    ["Scheduling", "Proposes a day. Tries again if the critic rejects it.", "Hands off to the critic"],
    ["Compliance", "Writes calendar, email, and Slack drafts.", "Hands off to Briefing"],
    ["Briefing", "Three outcomes and a call card.", "Then the supervisor closes"],
  ];
  const gap = 16;
  const cardW = (width - 96 - gap * 3) / 4;
  const body = `
    <text x="48" y="56" class="serif" font-size="34" fill="${INK}">The Benchmark team</text>
    <text x="48" y="88" font-size="16" fill="${BODY}">One lead routes four specialists. Maria approves money, dates, and anything a homeowner would see.</text>
    <rect x="48" y="116" width="${width - 96}" height="150" rx="14" fill="${BLUE}"/>
    <text x="72" y="158" fill="${PAPER}" font-size="26" font-weight="700">Supervisor</text>
    <text x="72" y="188" fill="${BLUE_SOFT}" font-size="16">The only router. It calls Intake, then Scheduling, then the critic, then Compliance and Briefing.</text>
    <text x="72" y="216" fill="${BLUE_SOFT}" font-size="16">A rejection returns to Scheduling. Three revisions is the cap. Nothing is sent from this demo.</text>
    <text x="72" y="244" fill="#c9d2f2" font-size="13">orchestrator/supervisor.ts. The checklist is critic.ts, not a fifth specialist.</text>
    ${cards
      .map((card, index) => {
        const x = 48 + index * (cardW + gap);
        return `<rect x="${x}" y="290" width="${cardW}" height="220" rx="14" fill="${PAPER}" stroke="${LINE}" stroke-width="1.5"/>
          <text x="${x + 20}" y="330" fill="${BLUE}" font-size="13" font-weight="700" letter-spacing="0.08em">SPECIALIST</text>
          <text x="${x + 20}" y="364" fill="${INK}" font-size="24" font-weight="700">${esc(card[0])}</text>
          <text x="${x + 20}" y="400" fill="${BODY}" font-size="15">${esc(card[1])}</text>
          <text x="${x + 20}" y="470" fill="${MUTED}" font-size="14">${esc(card[2])}</text>`;
      })
      .join("")}
    <text x="48" y="560" font-size="15" fill="${BODY}">The Thursday demo is the implemented path. A weekly report, a change-order replan, and a mailbox API are not in this repository.</text>
    <text x="48" y="592" font-size="14" fill="${MUTED}">Maria's approval sits outside the agents. Drafts stay in memory with status draft.</text>`;
  return shell({
    title: "The Benchmark team",
    desc: "Hero overview of the Benchmark supervisor and the four specialists Intake, Scheduling, Compliance, and Briefing.",
    width,
    height: 640,
    body,
  });
}

function agentDetail(agent) {
  const width = 1280;
  const height = 860;
  const sections = [
    ["TRIGGERS", agent.triggers],
    ["INPUTS", agent.inputs],
    ["OUTPUTS", agent.outputs],
    ["TOOLS", agent.tools],
    ["HANDS OFF TO", agent.handoff],
    ["WHERE MARIA APPROVES", agent.human],
  ];
  const cellW = 584;
  const cellH = 168;
  const body = `
    <text x="40" y="52" class="serif" font-size="32" fill="${INK}">${esc(agent.name)}</text>
    <text x="40" y="84" font-size="16" fill="${BODY}">${esc(agent.role)}</text>
    <text x="40" y="110" font-size="13" fill="${MUTED}">${esc(agent.file)}</text>
    ${sections
      .map((section, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = 40 + col * (cellW + 16);
        const y = 140 + row * (cellH + 16);
        const tone = section[0] === "WHERE MARIA APPROVES" ? RED : LINE;
        const fill = section[0] === "WHERE MARIA APPROVES" ? RED_SOFT : PAPER;
        return `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="12" fill="${fill}" stroke="${tone}" stroke-width="1.5"/>
          <text x="${x + 20}" y="${y + 32}" fill="${tone === RED ? RED : MUTED}" font-size="12" font-weight="700" letter-spacing="0.08em">${esc(section[0])}</text>
          <text x="${x + 20}" y="${y + 72}" fill="${INK}" font-size="16">${esc(section[1][0])}</text>
          <text x="${x + 20}" y="${y + 102}" fill="${BODY}" font-size="16">${esc(section[1][1])}</text>`;
      })
      .join("")}`;
  return shell({
    title: agent.name,
    desc: `${agent.name} for Benchmark: role, triggers, inputs, outputs, tools, hand-off, and where a person approves.`,
    width,
    height,
    body,
  });
}

function threeColumns({ title, subtitle, note, columns }) {
  const width = 1600;
  const height = 620;
  const gap = 16;
  const cardW = (width - 96 - gap * 2) / 3;
  const body = `
    <text x="48" y="52" class="serif" font-size="32" fill="${INK}">${esc(title)}</text>
    <text x="48" y="84" font-size="16" fill="${BODY}">${esc(subtitle)}</text>
    ${columns
      .map((column, index) => {
        const x = 48 + index * (cardW + gap);
        return `<rect x="${x}" y="112" width="${cardW}" height="430" rx="14" fill="${PAPER}" stroke="${LINE}" stroke-width="1.5"/>
          ${badge(x + 20, 132, column.badge, column.tone)}
          <text x="${x + 20}" y="188" fill="${INK}" font-size="24" font-weight="700">${esc(column.title)}</text>
          ${column.steps
            .map(
              (step, stepIndex) =>
                `<text x="${x + 20}" y="${240 + stepIndex * 56}" fill="${BLUE}" font-size="13" font-weight="700">${stepIndex + 1}</text>
                 <text x="${x + 44}" y="${240 + stepIndex * 56}" fill="${BODY}" font-size="15">${esc(step)}</text>`,
            )
            .join("")}
          <text x="${x + 20}" y="500" fill="${MUTED}" font-size="14">${esc(column.foot)}</text>`;
      })
      .join("")}
    <text x="48" y="590" font-size="14" fill="${MUTED}">${esc(note)}</text>`;
  return shell({
    title,
    desc: subtitle,
    width,
    height,
    body,
  });
}

function workflowDaily() {
  return threeColumns({
    title: "A project manager's day",
    subtitle: "Morning work is what this demo runs. Midday and closeout are the cadence, not extra code.",
    note: "Maria reviews every draft. The repository has no send path.",
    columns: [
      {
        tone: "demo",
        badge: "IN THE DEMO",
        title: "Morning",
        steps: [
          "Intake reads the calendar and the inbox.",
          "Scheduling proposes a day. The critic can reject it.",
          "Briefing writes the morning note.",
        ],
        foot: "See Thursday, and the quiet morning before 08:47.",
      },
      {
        tone: "planned",
        badge: "PLANNED",
        title: "Midday",
        steps: [
          "A change order or an RFI would be a new constraint.",
          "Scheduling would propose again. The critic would score it.",
          "That loop is not a separate command today.",
        ],
        foot: "Not implemented. Do not treat it as a feature.",
      },
      {
        tone: "planned",
        badge: "PLANNED",
        title: "End of day",
        steps: [
          "Client and sub updates would be drafted, not sent.",
          "The demo can draft one email and one Slack note.",
          "It does not write a closeout batch.",
        ],
        foot: "The one email and Slack note are status draft.",
      },
    ],
  });
}

function workflowWeekly() {
  return threeColumns({
    title: "The week around the day",
    subtitle: "These three checkpoints are a cadence for a project manager. None of them is a command in this repo.",
    note: "The runnable story is still one Thursday. Weekly drawings are plans, not shipped workflows.",
    columns: [
      {
        tone: "planned",
        badge: "PLANNED",
        title: "Monday look-ahead",
        steps: [
          "Read the week, not only today.",
          "Flag inspections, deliveries, and open quotes.",
          "Maria would approve the note to the owner.",
        ],
        foot: "Assumption A7 in TIME_SAVED.md, if it were built.",
      },
      {
        tone: "planned",
        badge: "PLANNED",
        title: "Mid-week risk",
        steps: [
          "Look for slips against the look-ahead.",
          "Name the jobs that lost a day.",
          "Do not quietly move a fixed inspection.",
        ],
        foot: "Assumption A8. Not a code path.",
      },
      {
        tone: "planned",
        badge: "PLANNED",
        title: "Friday owner report",
        steps: [
          "What finished, what slipped, what needs a decision.",
          "Draft only. The owner does not get it automatically.",
          "Maria approves the wording.",
        ],
        foot: "Assumption A9. Not a code path.",
      },
    ],
  });
}

function workflowRequest() {
  const width = 1640;
  const height = 820;
  const lanes = ["Sam Rivera", "Supervisor", "Intake", "Scheduling", "Compliance", "Briefing", "Maria"];
  const gutter = 180;
  const top = 150;
  const laneH = 78;
  const cols = 8;
  const colW = (width - gutter - 36) / cols;
  const steps = [
    { col: 0, lane: 0, title: "08:47 email", body: "Kitchen quote", fill: AMBER_SOFT, stroke: AMBER },
    { col: 0, lane: 1, title: "Opens Thursday", body: "Routes to Intake", fill: BLUE, stroke: BLUE, titleFill: PAPER, bodyFill: BLUE_SOFT },
    { col: 1, lane: 2, title: "Reads the day", body: "Overlap, J-1042", fill: PAPER, stroke: LINE },
    { col: 2, lane: 3, title: "Revision 1", body: "Estimate at 13:30", fill: PAPER, stroke: LINE },
    { col: 3, lane: 1, title: "Critic 75/100", body: "FOCUS_BLOCK", fill: PAPER, stroke: RED, titleFill: RED },
    { col: 4, lane: 3, title: "Revision 2", body: "09:40 to 11:20", fill: PAPER, stroke: LINE },
    { col: 5, lane: 1, title: "Critic 100/100", body: "Approved", fill: GREEN_SOFT, stroke: GREEN },
    { col: 6, lane: 4, title: "Drafts", body: "Nothing sent", fill: GREEN_SOFT, stroke: GREEN },
    { col: 6, lane: 5, title: "Call card", body: "No new promise", fill: GREEN_SOFT, stroke: GREEN },
    { col: 7, lane: 6, title: "Maria's gate", body: "She has not sent it", fill: PAPER, stroke: INK },
  ];
  const boxes = steps.map((step) => ({
    ...step,
    x: gutter + step.col * colW + 8,
    y: top + step.lane * laneH + 12,
    w: colW - 16,
    h: 54,
  }));
  const links = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [8, 9],
  ];
  const arrows = links
    .map(([fromIndex, toIndex]) => {
      const from = boxes[fromIndex];
      const to = boxes[toIndex];
      const x1 = from.x + from.w;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = to.y + to.h / 2;
      const mid = (x1 + x2) / 2;
      const path =
        from.col === to.col
          ? `M ${from.x + from.w / 2} ${from.y + from.h + 2} V ${to.y - 2}`
          : `M ${x1 + 2} ${y1} H ${mid} V ${y2} H ${x2 - 2}`;
      return `<path d="${path}" fill="none" stroke="${INK}" stroke-width="1.5" marker-end="url(#arrow)"/>`;
    })
    .join("");
  const bands = lanes
    .map((name, index) => {
      const y = top + index * laneH;
      const fill = index % 2 === 0 ? PAPER : "#efeae2";
      return `<rect x="28" y="${y}" width="${width - 56}" height="${laneH}" fill="${fill}"/>
        <text x="40" y="${y + 44}" fill="${INK}" font-size="14" font-weight="700">${esc(name)}</text>`;
    })
    .join("");
  const nodes = boxes
    .map(
      (box) => `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="${box.fill}" stroke="${box.stroke}" stroke-width="1.5"/>
        <text x="${box.x + 8}" y="${box.y + 22}" fill="${box.titleFill ?? INK}" font-size="13" font-weight="700">${esc(box.title)}</text>
        <text x="${box.x + 8}" y="${box.y + 40}" fill="${box.bodyFill ?? BODY}" font-size="12">${esc(box.body)}</text>`,
    )
    .join("");
  const body = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 1.2 L 8.5 5 L 0 8.8 Z" fill="${INK}"/>
      </marker>
    </defs>
    <text x="40" y="46" class="serif" font-size="30" fill="${INK}">Sam Rivera's kitchen request</text>
    <text x="40" y="76" font-size="15" fill="${BODY}">Thursday 12 March 2026. Summit Ridge Builders. The critic rejects the first plan. Drafts stay in memory.</text>
    <text x="40" y="104" font-size="14" fill="${MUTED}">This path is implemented. Bright Spark moves to 13:45. Dave and the 15:30 county window stay put.</text>
    ${bands}
    ${arrows}
    ${nodes}
    <text x="40" y="790" font-size="14" fill="${MUTED}">Revision 2 is protect-focus: Sam at 09:00, the estimate block at 09:40–11:20. Maria has not sent the email or the Slack note.</text>`;
  return shell({
    title: "Sam Rivera's kitchen request",
    desc: "Swimlane of the implemented Thursday run, from Sam's email to unsent drafts and Maria's approval gate.",
    width,
    height,
    body,
  });
}

const AUTOMATIONS = [
  {
    id: "automation-morning",
    title: "Morning intake and plan",
    badge: "IN THE DEMO",
    tone: "demo",
    assumption: "A1",
    manual: 25,
    review: 5,
    before: ["Open the calendar and the inbox.", "Write today's plan by hand.", "Hope the overlap is obvious."],
    after: ["Intake posts the overlap and the mail.", "Scheduling proposes. The critic scores it.", "Maria reads the brief. About 5 minutes."],
  },
  {
    id: "automation-rewrite",
    title: "Rewrite a double-booked morning",
    badge: "IN THE DEMO",
    tone: "demo",
    assumption: "A2",
    manual: 20,
    review: 4,
    before: ["Drag the estimate block by hand.", "Check lunch, Dave, and the county window.", "Tell the sub the time changed."],
    after: ["Revision 1 parks the estimate at 13:30.", "The critic rejects it. FOCUS_BLOCK.", "Revision 2 holds 09:40–11:20. Maria checks it."],
  },
  {
    id: "automation-draft",
    title: "Homeowner email and crew note",
    badge: "IN THE DEMO",
    tone: "demo",
    assumption: "A3",
    manual: 15,
    review: 2,
    before: ["Write the email from scratch.", "Write the Slack note from scratch.", "Remember what not to promise."],
    after: ["Compliance stages both as drafts.", "The call card lists the limits.", "Maria reviews. About 2 minutes. Nothing is sent."],
  },
  {
    id: "automation-certificate",
    title: "Insurance certificate check",
    badge: "IN THE DEMO",
    tone: "demo",
    assumption: "A4",
    manual: 10,
    review: 2,
    before: ["Search for Bright Spark's certificate.", "Decide if they can start.", "Risk telling Sam they are confirmed."],
    after: ["The job file already says it is expired.", "The call card says not to confirm them.", "Maria sees the flag before the call."],
  },
  {
    id: "automation-midday",
    title: "Midday change order or RFI",
    badge: "PLANNED",
    tone: "planned",
    assumption: "A5",
    manual: 30,
    review: 6,
    before: ["Take the call. Rebuild the afternoon.", "Chase the sub and the inspector.", "Hope lunch and the fixed window survive."],
    after: ["A new constraint would go to Scheduling.", "The critic would score the new day.", "This command does not exist yet."],
  },
  {
    id: "automation-eod",
    title: "End-of-day client and sub notes",
    badge: "PLANNED",
    tone: "planned",
    assumption: "A6",
    manual: 20,
    review: 4,
    before: ["Write each note at closeout.", "Repeat the same status three times.", "Send them before leaving the site."],
    after: ["A batch of drafts would wait for Maria.", "The demo writes one email and one Slack note.", "It does not run a closeout batch."],
  },
  {
    id: "automation-lookahead",
    title: "Monday look-ahead",
    badge: "PLANNED",
    tone: "planned",
    assumption: "A7",
    manual: 45,
    review: 8,
    before: ["Rebuild the week from texts and sheets.", "Miss an inspection or a delivery.", "Send the owner a late note."],
    after: ["A week note would be drafted.", "Maria would approve it.", "No weekly command exists in this repo."],
  },
  {
    id: "automation-risk",
    title: "Mid-week schedule risk",
    badge: "PLANNED",
    tone: "planned",
    assumption: "A8",
    manual: 30,
    review: 5,
    before: ["Compare the look-ahead with today.", "Discover a slip on Thursday.", "Move a meeting that was fixed."],
    after: ["Slips would be named, not silently fixed.", "Fixed inspections would stay put.", "Not implemented."],
  },
  {
    id: "automation-report",
    title: "Friday owner report",
    badge: "PLANNED",
    tone: "planned",
    assumption: "A9",
    manual: 40,
    review: 8,
    before: ["Collect finished work and slips.", "Write the owner by hand.", "Send it after hours."],
    after: ["A draft report would wait for Maria.", "The owner would not get it automatically.", "Not implemented."],
  },
];

function automation(item) {
  const width = 1440;
  const height = 700;
  const saved = item.manual - item.review;
  const column = (title, steps, x, fill, stroke) => `<rect x="${x}" y="150" width="640" height="420" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
    <text x="${x + 24}" y="190" fill="${stroke}" font-size="14" font-weight="700" letter-spacing="0.08em">${esc(title)}</text>
    ${steps
      .map(
        (step, index) =>
          `<text x="${x + 24}" y="${250 + index * 72}" fill="${INK}" font-size="18" font-weight="700">${index + 1}</text>
           <text x="${x + 56}" y="${250 + index * 72}" fill="${BODY}" font-size="16">${esc(step)}</text>`,
      )
      .join("")}`;
  const body = `
    <text x="40" y="48" class="serif" font-size="30" fill="${INK}">${esc(item.title)}</text>
    ${badge(40, 68, item.badge, item.tone)}
    <text x="40" y="120" font-size="16" fill="${BODY}">Illustrative estimate ${item.assumption}. Manual ${item.manual} min, review ${item.review} min, difference ${saved} min. Not a measurement.</text>
    ${column("BEFORE", item.before, 40, PAPER, LINE)}
    ${column("AFTER", item.after, 760, item.tone === "planned" ? AMBER_SOFT : GREEN_SOFT, item.tone === "planned" ? AMBER : GREEN)}
    <text x="40" y="640" font-size="15" fill="${MUTED}">From docs/TIME_SAVED.md. Maria reviews. Nothing in this demo is sent.</text>`;
  return shell({
    title: item.title,
    desc: `${item.title}. Before and after steps. Minutes are illustrative estimates from ${item.assumption}, not measured results.`,
    width,
    height,
    body,
  });
}

function timeSaved() {
  const width = 1440;
  const height = 980;
  const max = 40;
  const barW = 640;
  const rows = AUTOMATIONS.map((item) => ({
    id: item.assumption,
    title: item.title,
    saved: item.manual - item.review,
    tone: item.tone,
  }));
  const bars = rows
    .map((row, index) => {
      const y = 150 + index * 62;
      const widthPx = (row.saved / max) * barW;
      const fill = row.tone === "planned" ? AMBER : GREEN;
      return `<text x="40" y="${y + 22}" fill="${INK}" font-size="15" font-weight="700">${esc(row.id)}</text>
        <text x="90" y="${y + 22}" fill="${BODY}" font-size="15">${esc(row.title)}</text>
        <rect x="520" y="${y}" width="${barW}" height="28" rx="6" fill="#efeae2"/>
        <rect x="520" y="${y}" width="${widthPx}" height="28" rx="6" fill="${fill}"/>
        <text x="${520 + barW + 16}" y="${y + 20}" fill="${INK}" font-size="15" font-weight="700">${row.saved} min</text>`;
    })
    .join("");
  const body = `
    <text x="40" y="48" class="serif" font-size="30" fill="${INK}">Illustrative minutes, not measured results</text>
    <text x="40" y="80" font-size="16" fill="${BODY}">Each bar is manual minutes minus review minutes, from docs/TIME_SAVED.md. Green is a demo pattern. Amber is planned.</text>
    ${bars}
    <rect x="40" y="730" width="430" height="150" rx="12" fill="${GREEN_SOFT}" stroke="${GREEN}"/>
    <text x="60" y="766" fill="${GREEN}" font-size="13" font-weight="700">A DAY LIKE THURSDAY</text>
    <text x="60" y="806" fill="${INK}" font-size="28" font-weight="700">57 min</text>
    <text x="60" y="840" fill="${BODY}" font-size="14">A1+A2+A3+A4, once each. An estimate.</text>
    <rect x="490" y="730" width="430" height="150" rx="12" fill="${GREEN_SOFT}" stroke="${GREEN}"/>
    <text x="510" y="766" fill="${GREEN}" font-size="13" font-weight="700">A WEEK OF DEMO PATTERNS</text>
    <text x="510" y="806" fill="${INK}" font-size="28" font-weight="700">216 min</text>
    <text x="510" y="840" fill="${BODY}" font-size="14">Frequencies in TIME_SAVED.md. Per PM.</text>
    <rect x="940" y="730" width="460" height="150" rx="12" fill="${AMBER_SOFT}" stroke="${AMBER}" stroke-dasharray="7 5"/>
    <text x="960" y="766" fill="${AMBER}" font-size="13" font-weight="700">PLANNED ROWS, NOT IN THE CODE</text>
    <text x="960" y="806" fill="${INK}" font-size="28" font-weight="700">+246 min</text>
    <text x="960" y="840" fill="${BODY}" font-size="14">A5 through A9. Do not add this to the demo.</text>
    <text x="40" y="930" font-size="14" fill="${MUTED}">Not customer data. Not a study. Review time assumes Maria reads the draft and may reject it.</text>`;
  return shell({
    title: "Illustrative minutes",
    desc: "Bar chart of illustrative time savings from documented assumptions. Green bars are demo patterns. Amber bars are planned and not implemented.",
    width,
    height,
    body,
  });
}

function integrationMap() {
  const width = 1600;
  const height = 860;
  const mocked = [
    ["HubSpot", "Header mark only.", "No client and no API call."],
    ["Google Calendar", "Header mark.", "Calendar drafts stay in memory."],
    ["Slack", "A slack.draft is written.", "It is not posted."],
  ];
  const planned = [
    ["Gmail or Outlook", "email.draft is local.", "No mailbox API."],
    ["Procore", "Not referenced.", "No client in this repo."],
    ["QuickBooks", "Not referenced.", "No client in this repo."],
  ];
  const row = (items, y, tone) =>
    items
      .map((item, index) => {
        const x = 48 + index * 500;
        const stroke = tone === "planned" ? AMBER : GREEN;
        const fill = tone === "planned" ? AMBER_SOFT : PAPER;
        const dash = tone === "planned" ? ` stroke-dasharray="7 5"` : "";
        return `<rect x="${x}" y="${y}" width="468" height="180" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}/>
          <text x="${x + 24}" y="${y + 48}" fill="${INK}" font-size="22" font-weight="700">${esc(item[0])}</text>
          <text x="${x + 24}" y="${y + 88}" fill="${BODY}" font-size="16">${esc(item[1])}</text>
          <text x="${x + 24}" y="${y + 118}" fill="${BODY}" font-size="16">${esc(item[2])}</text>`;
      })
      .join("");
  const body = `
    <text x="48" y="52" class="serif" font-size="32" fill="${INK}">Where the day could connect</text>
    <text x="48" y="86" font-size="16" fill="${BODY}">Solid green is mocked in the demo. Dashed amber is not in the code. Neither row is a live integration.</text>
    <text x="48" y="140" fill="${GREEN}" font-size="13" font-weight="700" letter-spacing="0.08em">CONNECTED IN THE DEMO, MOCKED</text>
    ${row(mocked, 156, "demo")}
    <text x="48" y="400" fill="${AMBER}" font-size="13" font-weight="700" letter-spacing="0.08em">PLANNED, NOT IMPLEMENTED</text>
    ${row(planned, 416, "planned")}
    <text x="48" y="660" font-size="15" fill="${BODY}">The toolkit reads the Thursday fixture. It does not call these systems. There is no webhook handler.</text>
    <text x="48" y="800" font-size="14" fill="${MUTED}">Optional OpenAI polish is a prose call, not one of these connectors. The schedule never goes through it.</text>`;
  return shell({
    title: "Connectors",
    desc: "Connector map. HubSpot, Google Calendar, and Slack are mocked in the demo. Gmail, Outlook, Procore, and QuickBooks are planned and not implemented.",
    width,
    height,
    body,
  });
}

function integrationFlow() {
  const width = 1600;
  const height = 780;
  const boxes = [
    [48, 180, "Thursday fixture", "Calendar, inbox, job file"],
    [380, 180, "Read-only toolkit", "Events, inbox, and jobs"],
    [720, 180, "Supervisor routes", "Specialists, in order"],
    [1060, 180, "Drafts on the board", "status draft. No send."],
  ];
  const arrows = [300, 640, 980]
    .map(
      (x) =>
        `<line x1="${x}" y1="230" x2="${x + 70}" y2="230" stroke="${INK}" stroke-width="1.5" marker-end="url(#arrow)"/>`,
    )
    .join("");
  const body = `
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 1.2 L 8.5 5 L 0 8.8 Z" fill="${INK}"/>
      </marker>
    </defs>
    <text x="48" y="52" class="serif" font-size="32" fill="${INK}">What actually moves</text>
    <text x="48" y="86" font-size="16" fill="${BODY}">Solid arrows are the demo. A dashed border means named and not called.</text>
    ${boxes
      .map(
        (box) => `<rect x="${box[0]}" y="${box[1]}" width="250" height="110" rx="12" fill="${PAPER}" stroke="${LINE}" stroke-width="1.5"/>
          <text x="${box[0] + 16}" y="${box[1] + 44}" fill="${INK}" font-size="16" font-weight="700">${esc(box[2])}</text>
          <text x="${box[0] + 16}" y="${box[1] + 74}" fill="${BODY}" font-size="14">${esc(box[3])}</text>`,
      )
      .join("")}
    ${arrows}
    <rect x="48" y="360" width="1504" height="200" rx="14" fill="${PAPER}" stroke="${AMBER}" stroke-dasharray="7 5"/>
    <text x="72" y="404" fill="${AMBER}" font-size="14" font-weight="700">NOT CALLED</text>
    <text x="72" y="444" fill="${BODY}" font-size="16">HubSpot, Google Calendar, and Slack are named on the page or in a draft. No SDK call and no webhook.</text>
    <text x="72" y="480" fill="${BODY}" font-size="16">Gmail, Outlook, Procore, and QuickBooks are not referenced. An email.draft is not a mailbox API.</text>
    <text x="72" y="516" fill="${BODY}" font-size="16">OpenAI, if --live is set, may restyle prose. It does not choose times, totals, or dates.</text>
    <text x="48" y="640" font-size="15" fill="${MUTED}">If the critic never approves, the run stops at needs_human and Compliance does not write drafts.</text>`;
  return shell({
    title: "What actually moves",
    desc: "Data flow of the Benchmark demo. The fixture is read through the toolkit onto the board. Drafts stay in memory. External systems are not called.",
    width,
    height,
    body,
  });
}

function together() {
  const width = 1600;
  const height = 820;
  const steps = [
    ["1", "Request", "Sam's email at 08:47 is fixture data."],
    ["2", "Team", "Intake, Scheduling, and the critic run in order."],
    ["3", "Drafts", "Calendar, email, and Slack stay status draft."],
    ["4", "Maria", "She approves. The demo cannot send."],
  ];
  const body = `
    <text x="48" y="56" class="serif" font-size="32" fill="${INK}">One Thursday, put together</text>
    <text x="48" y="92" font-size="16" fill="${BODY}">The pieces that exist, and the minutes they illustrate. Planned tools are not part of the 57.</text>
    ${steps
      .map((step, index) => {
        const x = 48 + index * 380;
        return `<rect x="${x}" y="130" width="350" height="180" rx="14" fill="${PAPER}" stroke="${LINE}" stroke-width="1.5"/>
          <text x="${x + 20}" y="170" fill="${BLUE}" font-size="14" font-weight="700">${esc(step[0])}</text>
          <text x="${x + 48}" y="170" fill="${INK}" font-size="22" font-weight="700">${esc(step[1])}</text>
          <text x="${x + 20}" y="214" fill="${BODY}" font-size="16">${esc(step[2])}</text>`;
      })
      .join("")}
    <rect x="48" y="350" width="736" height="200" rx="14" fill="${GREEN_SOFT}" stroke="${GREEN}"/>
    <text x="72" y="394" fill="${GREEN}" font-size="13" font-weight="700">ILLUSTRATIVE, THIS DEMO</text>
    <text x="72" y="444" fill="${INK}" font-size="36" font-weight="700">57 minutes</text>
    <text x="72" y="484" fill="${BODY}" font-size="16">A1 through A4, once each. A day like Thursday.</text>
    <text x="72" y="514" fill="${BODY}" font-size="16">A week of those patterns, at the stated frequencies, is 216 minutes.</text>
    <rect x="808" y="350" width="744" height="200" rx="14" fill="${AMBER_SOFT}" stroke="${AMBER}" stroke-dasharray="7 5"/>
    <text x="832" y="394" fill="${AMBER}" font-size="13" font-weight="700">NOT ADDED IN</text>
    <text x="832" y="444" fill="${INK}" font-size="28" font-weight="700">Procore, QuickBooks, mail APIs</text>
    <text x="832" y="484" fill="${BODY}" font-size="16">They are not in the code, so they add no minutes here.</text>
    <text x="832" y="514" fill="${BODY}" font-size="16">Planned rows A5–A9 would be a separate 246 minutes.</text>
    <text x="48" y="610" font-size="16" fill="${BODY}">The team saves the illustrated time only if Maria's review is shorter than doing the task by hand, and only for the patterns the demo can run.</text>
    <text x="48" y="680" font-size="14" fill="${MUTED}">See docs/TIME_SAVED.md. These are assumptions. They are not customer data and not a measurement.</text>`;
  return shell({
    title: "One Thursday, put together",
    desc: "How the Thursday demo combines the team, the drafts, and Maria's approval, with illustrative minutes kept separate from planned tools.",
    width,
    height,
    body,
  });
}

function buildAll() {
  const files = {
    "agents-hero": agentsHero(),
    "workflow-daily": workflowDaily(),
    "workflow-weekly": workflowWeekly(),
    "workflow-request": workflowRequest(),
    "time-saved": timeSaved(),
    "integrations-map": integrationMap(),
    "integrations-flow": integrationFlow(),
    "integrations-together": together(),
  };
  for (const agent of AGENTS) files[`agent-${agent.id}`] = agentDetail(agent);
  for (const item of AUTOMATIONS) files[item.id] = automation(item);
  return files;
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
  const call = (method, params) => send(method, params, attached.sessionId);
  await call("Page.enable");
  const names = Object.keys(buildAll());
  for (const name of names) {
    const svg = readFileSync(new URL(`${name}.svg`, OUT), "utf8");
    const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const width = Number(match?.[1] ?? 1200);
    const height = Number(match?.[2] ?? 800);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:${BG}}</style></head><body>${svg}</body></html>`;
    writeFileSync(`/tmp/showcase-${name}.html`, html);
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
    await call("Page.navigate", { url: `file:///tmp/showcase-${name}.html` });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const image = await call("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(new URL(`${name}.png`, OUT), Buffer.from(image.data, "base64"));
    console.log("rendered", name);
  }
  await send("Target.closeTarget", { targetId: target.targetId });
  ws.close();
}

mkdirSync(OUT, { recursive: true });
const files = buildAll();
for (const [name, svg] of Object.entries(files)) writeFileSync(new URL(`${name}.svg`, OUT), svg);
console.log("wrote", Object.keys(files).length, "svg");

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
        "--user-data-dir=/tmp/chrome-showcase",
        "about:blank",
      ],
      { stdio: "ignore", detached: true },
    );
    chrome.unref();
    for (let attempt = 0; attempt < 30; attempt += 1) {
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
