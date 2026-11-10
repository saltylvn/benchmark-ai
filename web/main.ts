import { DAY } from "../src/fixtures/thursday.js";
import { findOverlaps } from "../src/schedule/gaps.js";
import { runWorkflow } from "../src/orchestrator/supervisor.js";
import { range } from "../src/time.js";
import type { CalendarEvent, CallCard, RunState, TraceEvent } from "../src/types.js";

type Tab = "thursday" | "plan" | "brief";
type BlockView = {
  id: string;
  title: string;
  kind: string;
  start: number;
  end: number;
  reason: string;
  lane: number;
  clash: boolean;
};

const PIPELINE = ["intake", "researcher", "planner", "critic", "executor", "brief"] as const;
const THEME_KEY = "benchmark-theme";

const SHORT: Record<string, string> = {
  "Morning huddle": "Huddle",
  "Estimate block · J-1042": "Estimate",
  "Bright Spark · date check": "Bright Spark",
  "Check-in with Dave": "Dave",
  Lunch: "Lunch",
  "Site walk · 123 Example Ln": "Site walk",
  "Crew schedule review": "Crew",
  "Pinecrest · rough-in window": "Pinecrest",
  "Daily closeout": "Closeout",
  "Prep · Rivera kitchen": "Prep",
  "Rivera kitchen · scope call": "Rivera",
  "Prep · Bright Spark": "Prep",
};

const mock = {
  name: "mock",
  polish: async (input: { draft: string }) => input.draft,
};

const thursdayRun = await runWorkflow({ workflow: "thursday", model: mock });
const morning = await runWorkflow({ workflow: "morning", model: mock });

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let tab: Tab = "thursday";
let cursor = reduced ? thursdayRun.trace.length : 0;
let playing = false;
let timer = 0;
let pickedStep: number | null = null;
let pickedBlock: string | null = null;

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = shell(thursdayRun);
bind();
renderPlan(morning);
renderBrief(morning);
const initial = tabFromHash();
if (initial && initial !== "thursday") show(initial, false);
frame();
window.scrollTo(0, 0);
if (!reduced && tab === "thursday") play();

function team(): { id: string; name: string; role: string; job: string }[] {
  return [
    {
      id: "intake",
      name: "Intake",
      role: "Intake and estimating",
      job: "Turns the request into a job and drafts the quote.",
    },
    {
      id: "scheduling",
      name: "Scheduling",
      role: "Scheduling and subs",
      job: "Builds the timeline and coordinates the subcontractors.",
    },
    {
      id: "compliance",
      name: "Drafting",
      role: "Drafts for review",
      job: "Turns an approved day into calendar, email, and Slack drafts.",
    },
    {
      id: "briefing",
      name: "Briefing",
      role: "PM briefing",
      job: "Gives the project manager the morning read: today, risks, and decisions.",
    },
  ];
}

function diagramId(agent?: string): string {
  if (agent === "supervisor" || agent === "critic") return "supervisor";
  if (agent === "intake" || agent === "researcher") return "intake";
  if (agent === "planner") return "scheduling";
  if (agent === "executor") return "compliance";
  if (agent === "brief") return "briefing";
  return agent ?? "";
}

function connectorIcons(): string {
  return `<span class="connectors" aria-label="Connected to HubSpot, Google Calendar, and Slack">
    <span class="bubble" title="HubSpot"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF7A59" d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.978v-.067A2.2 2.2 0 0 0 17.238.845h-.067a2.2 2.2 0 0 0-2.193 2.193v.067a2.196 2.196 0 0 0 1.252 1.973V7.93a6.22 6.22 0 0 0-2.969 1.31L5.434 3.145a2.499 2.499 0 0 0 .08-.64 2.58 2.58 0 1 0-2.58 2.58c.48 0 .93-.132 1.31-.36l7.697 5.99a6.176 6.176 0 0 0 .077 7.172l-2.304 2.304a2.056 2.056 0 0 0-.607-.097 2.066 2.066 0 1 0 2.066 2.066 2.05 2.05 0 0 0-.097-.607l2.272-2.272a6.197 6.197 0 1 0 4.816-10.0zm-.931 9.3a3.11 3.11 0 1 1 0-6.221 3.11 3.11 0 0 1 0 6.221z"/></svg></span>
    <span class="bubble" title="Google Calendar"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" fill="#fff"/><path fill="#1a73e8" d="M3 8h18V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v1z"/><path fill="#1a73e8" d="M3 8h18v2H3z"/><path fill="#ea4335" d="M8 3.2h1.6v3.2H8z"/><path fill="#fbbc04" d="M14.4 3.2H16v3.2h-1.6z"/><text x="12" y="16.6" text-anchor="middle" font-size="7.5" font-family="Arial, sans-serif" font-weight="700" fill="#1a73e8">31</text></svg></span>
    <span class="bubble" title="Slack"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#36C5F0" d="M6.3 14.6a1.7 1.7 0 1 1-1.7-1.7h1.7v1.7zm.9 0a1.7 1.7 0 1 1 3.4 0v4.3a1.7 1.7 0 1 1-3.4 0v-4.3z"/><path fill="#2EB67D" d="M9.4 6.3a1.7 1.7 0 1 1 1.7-1.7v1.7H9.4zm0 .9a1.7 1.7 0 1 1 0 3.4H5.1a1.7 1.7 0 1 1 0-3.4h4.3z"/><path fill="#ECB22E" d="M17.7 9.4a1.7 1.7 0 1 1 1.7 1.7h-1.7V9.4zm-.9 0a1.7 1.7 0 1 1-3.4 0V5.1a1.7 1.7 0 1 1 3.4 0v4.3z"/><path fill="#E01E5A" d="M14.6 17.7a1.7 1.7 0 1 1-1.7 1.7v-1.7h1.7zm0-.9a1.7 1.7 0 1 1 0-3.4h4.3a1.7 1.7 0 1 1 0 3.4h-4.3z"/></svg></span>
  </span>`;
}

function shell(state: RunState): string {
  const mail = state.inbox[0];
  return `
    <header class="top">
      <div class="wrap top-inner">
        <div class="brand">
          <strong>Benchmark</strong>
          ${connectorIcons()}
        </div>
        <nav class="tabs" aria-label="Demos">
          <button type="button" data-tab="thursday" aria-pressed="true">Thursday</button>
          <button type="button" data-tab="plan" aria-pressed="false">Day plan</button>
          <button type="button" data-tab="brief" aria-pressed="false">Brief</button>
        </nav>
        <div class="top-tools">
          <p class="pill">Mock mode · nothing sent</p>
          <button type="button" class="theme-toggle" id="theme-toggle" aria-pressed="false" aria-label="Switch to dark mode">
            <span class="knob-track" aria-hidden="true"><span class="knob"></span></span>
            <span class="theme-toggle-text">Light</span>
          </button>
        </div>
      </div>
    </header>
    <main class="wrap">
      <section class="about">
        <p class="kicker">Benchmark</p>
        <h2>A team of AI agents for construction project managers.</h2>
        <p>Benchmark takes care of the repetitive admin that eats up a PM's day, like turning requests into quotes, keeping schedules and subcontractors in sync, tracking permits and paperwork, and sending invoices. The PM steps in only for the decisions that actually need them.</p>
        <p>Every job runs from the first inquiry to final payment in one organized place, so nothing slips and the PM always knows where things stand.</p>
        <ul class="benefits">
          <li>
            <strong>Intake and quoting.</strong>
            <span>Emails, forms, and call notes become organized jobs automatically, and draft quotes are ready for review instead of being built from scratch.</span>
          </li>
          <li>
            <strong>Scheduling and subs.</strong>
            <span>Timelines are built and updated on their own, subcontractors get their assignments and reminders, and when a delay or bad weather hits, the schedule is reshuffled without a pile of phone calls.</span>
          </li>
          <li>
            <strong>Permits and compliance.</strong>
            <span>Permit deadlines, inspections, insurance certificates, and lien waivers are tracked automatically, so nothing expires or gets missed.</span>
          </li>
          <li>
            <strong>Billing.</strong>
            <span>Invoices go out when milestones are hit, change orders are logged, and late payments are followed up, so cash keeps coming in without manual chasing.</span>
          </li>
          <li>
            <strong>Daily clarity.</strong>
            <span>Each morning the PM gets a briefing covering what's happening today, which jobs are at risk, and what needs a decision. That replaces digging through texts, emails, and spreadsheets.</span>
          </li>
          <li>
            <strong>Control and trust.</strong>
            <span>Every agent action is visible and can be undone. The PM approves the key moments, so the automation never runs unchecked.</span>
          </li>
        </ul>
        <p class="about-close">Less time on admin and follow-ups, fewer dropped balls, faster quotes and payments, and more of the PM's time spent on the jobs themselves.</p>
      </section>
      <section class="org" id="org" aria-label="The Benchmark team">
        <p class="kicker">Orchestration</p>
        <h2>Four agents. Benchmark decides who goes next.</h2>
        <p class="org-lead">Benchmark does not price the job or text the subs. It hands the work to one specialist at a time. If a plan breaks Maria's rules, it comes back before Scheduling tries again.</p>
        <div class="org-chart">
          <article class="org-head" data-agent="supervisor">
            <strong>Benchmark</strong>
            <span class="role">The team</span>
            <span class="job">Routes the work. Maria approves money, dates, and anything a homeowner would see.</span>
            <span class="state">Waiting</span>
          </article>
          <div class="org-stem" aria-hidden="true"></div>
          <ul class="org-team">
            ${team()
              .map(
                (agent) => `<li data-agent="${agent.id}">
              <strong>${esc(agent.name)}</strong>
              <span class="role">${esc(agent.role)}</span>
              <span class="job">${esc(agent.job)}</span>
              <span class="state">Waiting</span>
            </li>`,
              )
              .join("")}
          </ul>
        </div>
        <ol class="org-flow" aria-label="How a run moves">
          <li>Intake</li>
          <li>Scheduling</li>
          <li>Drafting</li>
          <li>Briefing</li>
        </ol>
        <p class="org-return">A rejected schedule comes back to Benchmark, and Scheduling tries again. Nothing goes to the homeowner or the crew until Maria approves it.</p>
      </section>
      <section id="view-thursday">
        <div class="lede">
          <div>
            <h1>A kitchen request at 8:47.</h1>
            <p>${esc(state.dateLabel)}. ${esc(state.persona)} already has a double-booked morning. Sam Rivera wants a quote for 123 Example Ln. Press play. Benchmark makes room for the call, keeps the estimate block, and drafts the note. Nothing is sent.</p>
          </div>
          <div class="controls">
            <button type="button" class="primary" id="play">Play</button>
            <div class="secondary">
              <button type="button" id="step">Step</button>
              <button type="button" id="skip">Skip to result</button>
              <span class="count" id="count"></span>
            </div>
          </div>
        </div>
        <p class="keys">Space plays and pauses. Right arrow steps. Click a block to read why it moved.</p>
        <ol class="rail" id="rail"></ol>
        <p class="note">The chart above is this run. Press play and the agent Benchmark has called lights up. Specialists do not call each other. A rejection comes back to Benchmark, then Scheduling tries again.</p>
        <div id="board"></div>
        <div class="split" id="split">
          <div>
            <p class="column-label">The email and the team</p>
            <article class="card ask">
              <p class="kicker">${mail ? esc(mail.at) + " · " + esc(mail.from) : "Inbox"}</p>
              <h2>${mail ? esc(mail.subject) : "No request"}</h2>
              <p class="letter">${mail ? esc(mail.body) : ""}</p>
            </article>
            <ol class="trace" id="trace" aria-live="polite"></ol>
          </div>
          <div class="side" id="side"></div>
        </div>
      </section>
      <section id="view-plan" hidden></section>
      <section id="view-brief" hidden></section>
      <footer class="foot">
        Same engine as <code>npm run demo</code>. Fixture accounts are fictional. Drafts stay in the browser.
        <a href="https://github.com/saltylvn/benchmark-ai">Source</a>
      </footer>
    </main>
  `;
}

function bind(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => show(button.dataset.tab as Tab));
  });
  byId("play").addEventListener("click", toggle);
  byId("step").addEventListener("click", () => {
    pause();
    advance();
  });
  byId("skip").addEventListener("click", () => {
    pause();
    cursor = thursdayRun.trace.length;
    pickedStep = null;
    frame();
  });
  byId("trace").addEventListener("click", (event) => {
    const node = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-step]");
    if (!node?.dataset.step) return;
    pickedStep = Number(node.dataset.step);
    frame();
  });
  document.addEventListener("click", (event) => {
    const node = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-block]");
    if (!node?.dataset.block) return;
    pickedBlock = pickedBlock === node.dataset.block ? null : node.dataset.block;
    frame();
  });
  byId("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
  applyTheme(readTheme());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (readTheme() === "system") applyTheme("system");
  });
  window.addEventListener("hashchange", () => {
    const next = tabFromHash();
    if (next) show(next, false);
  });
  window.addEventListener("keydown", (event) => {
    if (tab !== "thursday") return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button, a, input, textarea")) return;
    if (event.key === " ") {
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      pause();
      advance();
    }
  });
}

function readTheme(): "light" | "dark" | "system" {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

function applyTheme(choice: "light" | "dark" | "system"): void {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const toggle = document.querySelector<HTMLButtonElement>("#theme-toggle");
  const label = toggle?.querySelector(".theme-toggle-text");
  if (toggle) {
    toggle.setAttribute("aria-pressed", dark ? "true" : "false");
    toggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  }
  if (label) label.textContent = dark ? "Dark" : "Light";
}

function show(next: Tab, updateHash = true): void {
  tab = next;
  if (next !== "thursday") pause();
  for (const name of ["thursday", "plan", "brief"] as const) {
    byId(`view-${name}`).hidden = name !== next;
    const button = document.querySelector<HTMLButtonElement>(`[data-tab="${name}"]`);
    if (!button) continue;
    button.setAttribute("aria-pressed", name === next ? "true" : "false");
  }
  if (updateHash && location.hash !== `#${next}`) history.replaceState(null, "", `#${next}`);
  window.scrollTo(0, 0);
}

function tabFromHash(): Tab | null {
  const name = location.hash.replace("#", "");
  if (name === "thursday" || name === "plan" || name === "brief") return name;
  return null;
}

function play(): void {
  if (cursor >= thursdayRun.trace.length) cursor = 0;
  playing = true;
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (cursor >= thursdayRun.trace.length) {
      pause();
      frame();
      return;
    }
    advance();
  }, 900);
  frame();
}

function pause(): void {
  playing = false;
  window.clearInterval(timer);
  syncPlayButton();
}

function toggle(): void {
  if (playing) pause();
  else play();
}

function syncPlayButton(): void {
  const done = !playing && cursor >= thursdayRun.trace.length;
  const playButton = document.querySelector<HTMLButtonElement>("#play");
  const lede = document.querySelector(".lede");
  if (playButton) playButton.textContent = playing ? "Pause" : done ? "Play demo" : "Play";
  lede?.classList.toggle("is-done", done);
}

function advance(): void {
  if (cursor < thursdayRun.trace.length) cursor += 1;
  if (cursor >= thursdayRun.trace.length) playing = false;
  frame();
}

function frame(): void {
  const revealed = thursdayRun.trace.slice(0, cursor);
  const activeIndex = pickedStep != null && pickedStep < cursor ? pickedStep : cursor - 1;
  const active = activeIndex >= 0 ? thursdayRun.trace[activeIndex] : undefined;
  const approved = revealed.some((event) => event.agent === "critic" && /approved/i.test(event.title));
  const rejected = revealed.some((event) => event.agent === "critic" && /rejected/i.test(event.title));
  syncPlayButton();
  byId("count").textContent = `${cursor} / ${thursdayRun.trace.length}`;
  byId("rail").innerHTML = rail(active);
  const seen = new Set<string>(revealed.map((event) => diagramId(event.agent)));
  const workingId = diagramId(active?.agent);
  document.querySelectorAll<HTMLElement>("[data-agent]").forEach((node) => {
    const id = node.dataset.agent ?? "";
    const working = id === workingId && revealed.length > 0;
    node.classList.toggle("is-on", working);
    const state = node.querySelector(".state");
    if (!state) return;
    if (revealed.length === 0) state.textContent = "Waiting";
    else if (working) state.textContent = "Working";
    else if (seen.has(id)) state.textContent = "Done";
    else state.textContent = "Waiting";
  });
  byId("trace").innerHTML =
    revealed.length === 0
      ? `<li class="step"><span class="who supervisor">Supervisor</span> <strong>Waiting to open Thursday.</strong></li>`
      : revealed
          .map((event, index) => stepHtml(event, index, index === activeIndex))
          .join("");
  const trace = byId("trace");
  const latest = trace.querySelector<HTMLElement>(".is-latest, .is-picked");
  if (playing && latest) {
    const top = latest.offsetTop - trace.offsetTop;
    trace.scrollTo({ top: Math.max(0, top - 8) });
  }
  const blocks = approved ? viewsFromPlan(thursdayRun) : viewsFromEvents(thursdayRun.events);
  byId("board").innerHTML = boardHtml(blocks, approved, rejected);
  const side = sideHtml(revealed);
  byId("side").innerHTML = side;
  byId("split").classList.toggle("is-single", side.trim() === "");
}

function rail(active: TraceEvent | undefined): string {
  const current = diagramId(active?.agent);
  const bad = active?.agent === "critic" && /rejected/i.test(active.title);
  const good = active?.agent === "critic" && /approved/i.test(active.title);
  return [{ id: "supervisor", name: "Benchmark" }, ...team()].map((agent) => {
    const on = agent.id === current;
    const cls = ["", on ? "is-on" : "", on && bad ? "is-bad" : "", on && good ? "is-good" : ""]
      .filter(Boolean)
      .join(" ");
    return `<li class="${cls}"><span class="dot"></span>${esc(agent.name)}</li>`;
  }).join("");
}

function stepHtml(event: TraceEvent, index: number, active: boolean): string {
  const open = active;
  return `
    <li>
      <button type="button" class="step${active ? " is-latest is-picked" : ""}" data-step="${index}">
        <span class="meta">
          <time>${esc(event.at)}</time>
          <span class="who ${esc(event.agent)}">${esc(label(event.agent))}</span>
          <strong>${esc(event.title)}</strong>
        </span>
        ${open ? `<p class="detail">${esc(event.detail)}</p>` : ""}
        ${open && event.handoff ? `<p class="handoff">→ ${esc(label(event.handoff.to))} · ${esc(event.handoff.reason)}</p>` : ""}
      </button>
    </li>
  `;
}

function boardHtml(blocks: BlockView[], approved: boolean, rejected: boolean): string {
  const failure = thursdayRun.critiques[0]?.failures[0];
  const selected = blocks.find((block) => block.id === pickedBlock);
  return `
    <article class="card board">
      <p class="kicker">${approved ? "After" : "Before"}</p>
      <h2>${approved ? "The rewrite" : "The day as it stands"}</h2>
      <p class="caption">${approved ? "Approved. The estimate block stays in the morning." : "Bright Spark is sitting on the estimate block."}</p>
      ${scheduleHtml(blocks)}
      ${
        rejected && !approved && failure
          ? `<p class="callout"><strong>${esc(String(thursdayRun.critiques[0]?.score ?? ""))}/100 · ${esc(failure.code)}</strong>${esc(failure.detail)}</p>`
          : ""
      }
      ${selected ? whyHtml(selected, approved) : ""}
    </article>
  `;
}

function sideHtml(revealed: TraceEvent[]): string {
  const showDrafts = revealed.some((event) => event.agent === "executor");
  const showBrief = revealed.some((event) => event.agent === "brief");
  return `
    ${showBrief && thursdayRun.brief ? briefCard(thursdayRun.brief.headline, thursdayRun.brief.outcomes, thursdayRun.brief.callCard) : ""}
    ${showDrafts ? draftsHtml(thursdayRun) : ""}
  `;
}

function briefCard(headline: string, outcomes: string[], callCard: CallCard | undefined): string {
  const card = callCard;
  return `
    <article class="card">
      <p class="kicker">Brief</p>
      <h2>${esc(headline)}</h2>
      <ol class="outcomes">${outcomes.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>
      ${
        card
          ? `<h3>Call card · ${esc(card.when)}</h3>
             <p>${esc(card.whyNow)}</p>
             <h3>Ask</h3>
             <ul class="plain">${card.questions.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
             <h3>Do not promise</h3>
             <ul class="plain">${card.doNotPromise.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
             <p class="caption">Leave with ${esc(card.success)}.</p>`
          : ""
      }
    </article>
  `;
}

function draftsHtml(state: RunState): string {
  const items = state.actions
    .filter((action) => action.type === "email.draft" || action.type === "slack.draft")
    .map((action) => {
      if (action.type === "email.draft") {
        return `<article class="draft"><span class="tag">Email draft · staged ${esc(action.sendAt)} · not sent</span><strong>${esc(action.subject)}</strong><p>${esc(action.body)}</p></article>`;
      }
      return `<article class="draft"><span class="tag">${esc(action.channel)} · Slack draft · not sent</span><p>${esc(action.text)}</p></article>`;
    })
    .join("");
  if (!items) return "";
  return `<article class="card drafts">${items}</article>`;
}

function whyHtml(block: BlockView, approved: boolean): string {
  const original = thursdayRun.events.find((event) => event.id === block.id);
  let movement = "Already on the book.";
  if (approved && original && (original.start !== block.start || original.end !== block.end)) {
    movement = `Moved from ${range(original.start, original.end)}.`;
  } else if (approved && !original) {
    movement = "Added for the kitchen request.";
  } else if (approved && original) {
    movement = "Held.";
  }
  return `
    <div class="why">
      <strong>${esc(block.title)}</strong>
      <p class="when">${esc(range(block.start, block.end))} · ${esc(movement)}</p>
      <p>${esc(block.reason || original?.notes || "On the calendar before the team runs.")}</p>
    </div>
  `;
}

function renderPlan(state: RunState): void {
  const before = viewsFromEvents(state.events);
  const after = viewsFromPlan(state);
  const clashes = findOverlaps(state.events);
  const focusBlock = state.plan?.blocks.find((block) => block.id === "focus");
  const brightspark = state.plan?.blocks.find((block) => block.id === "brightspark");
  const proposed =
    focusBlock && brightspark
      ? `Estimate block stays ${range(focusBlock.start, focusBlock.end)}. Bright Spark moves to ${range(brightspark.start, brightspark.end)}.`
      : "Proposed day";
  byId("view-plan").innerHTML = `
    <div class="lede">
      <div>
        <h1>The morning, before anyone writes.</h1>
        <p>${esc(state.goal)}</p>
      </div>
    </div>
    <div class="stack">
      <article class="card">
        <p class="kicker">Priorities</p>
        <ul class="priorities">${state.priorities.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
      </article>
      <article class="card">
        <p class="kicker">Conflict</p>
        <h2>${clashes[0] ? `${esc(clashes[0].a.title)} overlaps ${esc(clashes[0].b.title)}.` : "No overlap."}</h2>
        ${scheduleHtml(before)}
      </article>
      ${state.attempts
        .map((plan, index) => {
          const critique = state.critiques[index];
          const focus = plan.blocks.find((block) => block.kind === "focus");
          const failure = critique?.failures[0];
          const good = critique?.approved === true;
          return `
            <article class="card attempt">
              <header>
                <strong>${index + 1} · ${esc(strategyLabel(plan.strategy))}</strong>
                <span class="${good ? "score-good" : "score-bad"}">${critique ? `${critique.score}/100 · ${good ? "approved" : "rejected"}` : ""}</span>
              </header>
              <p>${focus ? `Focus at ${esc(range(focus.start, focus.end))}. ${esc(focus.reason)}` : ""}</p>
              ${failure ? `<p class="callout"><strong>${esc(failure.code)}</strong>${esc(failure.detail)}</p>` : ""}
            </article>
          `;
        })
        .join("")}
      <article class="card">
        <p class="kicker">Proposed day</p>
        <h2>${esc(proposed)}</h2>
        ${scheduleHtml(after)}
      </article>
    </div>
  `;
}

function renderBrief(state: RunState): void {
  const brief = state.brief;
  if (!brief) {
    byId("view-brief").innerHTML = `<p>No brief.</p>`;
    return;
  }
  byId("view-brief").innerHTML = `
    <div class="lede">
      <div>
        <h1>Morning brief</h1>
        <p>Written before the 8:47 request. The call card stays on the Thursday tab.</p>
      </div>
    </div>
    <article class="paper">
      <p class="kicker">${esc(state.dateLabel)}</p>
      <h2>${esc(brief.headline)}</h2>
      <ol class="outcomes">${brief.outcomes.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>
      <h3>The day</h3>
      <ul class="day">
        ${brief.schedule
          .map(
            (row) =>
              `<li><time>${esc(row.time)}</time><span>${esc(row.title)}</span><span class="tag-note${row.note === "held" ? "" : " is-move"}">${esc(row.note)}</span></li>`,
          )
          .join("")}
      </ul>
      <h3>Watch</h3>
      <ul class="priorities">${brief.watchouts.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
    </article>
  `;
}

const CAL_START = 8 * 60;
const CAL_END = 18 * 60;
const HOUR_PX = 76;

function scheduleHtml(blocks: BlockView[]): string {
  const lanes = Math.max(1, ...blocks.map((block) => block.lane + 1));
  const height = ((CAL_END - CAL_START) / 60) * HOUR_PX;
  const hours = Array.from({ length: (CAL_END - CAL_START) / 60 }, (_, index) => CAL_START + index * 60);
  const header = demoDay();
  return `
    <div class="gcal-frame">
      <div class="gcal-date">
        <span>${esc(header.weekday)}</span>
        <strong>${esc(header.date)}</strong>
      </div>
      <div class="gcal">
        <div class="g-gutter" style="height:${height}px" aria-hidden="true">
          ${hours
            .map(
              (minute) =>
                `<div class="g-hour" style="height:${HOUR_PX}px"><span>${esc(hourLabel(minute))}</span></div>`,
            )
            .join("")}
        </div>
        <div class="g-day" style="height:${height}px">
          ${hours.map(() => `<div class="g-line" style="height:${HOUR_PX}px"></div>`).join("")}
          ${blocks
            .map((block) => {
              const top = ((block.start - CAL_START) / 60) * HOUR_PX;
              const eventHeight = Math.max(((block.end - block.start) / 60) * HOUR_PX - 4, 20);
              const width = 100 / lanes;
              const left = block.lane * width;
              const name = SHORT[block.title] ?? block.title;
              const selected = pickedBlock === block.id ? " is-selected" : "";
              const clash = block.clash ? " is-clash" : "";
              const when = `${gClock(block.start)} – ${gClock(block.end)}`;
              return `<button type="button" class="g-event ${esc(kindOf(block))}${selected}${clash}" data-block="${esc(block.id)}" style="top:${top + 2}px;height:${eventHeight}px;left:calc(${left}% + 4px);width:calc(${width}% - 10px)" title="${esc(block.title)}" aria-label="${esc(block.title)}, ${esc(when)}"><span class="g-title">${esc(name)}</span>${eventHeight > 34 ? `<span class="g-when">${esc(when)}</span>` : ""}</button>`;
            })
            .join("")}
        </div>
      </div>
    </div>
  `;
}

function demoDay(): { weekday: string; date: string } {
  const match = DAY.dateLabel.match(/^(\w+),\s+\w+\s+(\d+)/);
  const weekday = match?.[1]?.slice(0, 3) ?? "Thu";
  const date = match?.[2] ?? "12";
  return { weekday, date };
}

function hourLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${suffix}`;
}

function gClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return mins === 0 ? `${twelve} ${suffix}` : `${twelve}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function viewsFromEvents(events: CalendarEvent[]): BlockView[] {
  const clashes = new Set(findOverlaps(events).flatMap((pair) => [pair.a.id, pair.b.id]));
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  return withLanes(
    sorted.map((event) => ({
      id: event.id,
      title: event.title,
      kind: event.kind,
      start: event.start,
      end: event.end,
      reason: event.notes ?? "On the calendar before the team runs.",
      lane: 0,
      clash: clashes.has(event.id),
    })),
  );
}

function viewsFromPlan(state: RunState): BlockView[] {
  const blocks = state.plan?.blocks ?? [];
  return withLanes(
    blocks.map((block) => ({
      id: block.id,
      title: block.title,
      kind: block.kind,
      start: block.start,
      end: block.end,
      reason: block.reason,
      lane: 0,
      clash: false,
    })),
  );
}

function withLanes(blocks: BlockView[]): BlockView[] {
  const ends: number[] = [];
  return blocks.map((block) => {
    let lane = ends.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = ends.length;
      ends.push(block.end);
    } else {
      ends[lane] = block.end;
    }
    return { ...block, lane };
  });
}

function kindOf(block: { id: string; kind: string }): string {
  if (block.id === "rivera") return "urgent";
  if (block.kind === "prep") return "prep";
  return block.kind;
}

function strategyLabel(strategy: string): string {
  return strategy === "protect-focus" ? "Protect focus" : "Client-first";
}

function label(agent: string): string {
  if (agent === "supervisor" || agent === "critic") return "Benchmark";
  if (agent === "intake" || agent === "researcher") return "Intake";
  if (agent === "planner") return "Scheduling";
  if (agent === "executor") return "Drafting";
  if (agent === "brief") return "Briefing";
  return agent.slice(0, 1).toUpperCase() + agent.slice(1);
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node;
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
