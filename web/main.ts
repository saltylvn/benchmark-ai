import { DAY } from "../src/fixtures/tuesday.js";
import { findOverlaps } from "../src/schedule/gaps.js";
import { runWorkflow } from "../src/orchestrator/supervisor.js";
import { range } from "../src/time.js";
import type { CalendarEvent, CallCard, RunState, TraceEvent } from "../src/types.js";

type Tab = "war" | "plan" | "brief";
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
const THEME_KEY = "atlas-theme";

const SHORT: Record<string, string> = {
  "Team standup": "Standup",
  "Focus · CaseFlow denial queue": "Focus",
  "Northwind Health · quarterly review": "Northwind",
  "1:1 with Samira": "1:1",
  Lunch: "Lunch",
  "Wellness walk": "Walk",
  "CaseFlow design review": "CaseFlow",
  "Halcyon Benefits · batch 441": "Halcyon",
  "Wrap · ticket hygiene": "Wrap",
  "Prep · Meridian Medical": "Prep",
  "Meridian Medical · escalation": "Meridian",
  "Prep · Northwind Health": "Prep",
};

const mock = {
  name: "mock",
  polish: async (input: { draft: string }) => input.draft,
};

const war = await runWorkflow({ workflow: "war-room", model: mock });
const morning = await runWorkflow({ workflow: "morning", model: mock });

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let tab: Tab = "war";
let cursor = reduced ? war.trace.length : 0;
let playing = false;
let timer = 0;
let pickedStep: number | null = null;
let pickedBlock: string | null = null;

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Missing #app");

app.innerHTML = shell(war);
bind();
renderPlan(morning);
renderBrief(morning);
const initial = tabFromHash();
if (initial && initial !== "war") show(initial, false);
frame();
window.scrollTo(0, 0);
if (!reduced && tab === "war") play();

function team(): { id: string; name: string; role: string; job: string }[] {
  return [
    {
      id: "intake",
      name: "Intake",
      role: "Reader",
      job: "Reads the calendar and the inbox, and flags conflicts.",
    },
    {
      id: "researcher",
      name: "Research",
      role: "Account specialist",
      job: "Pulls the HubSpot company record.",
    },
    {
      id: "planner",
      name: "Planner",
      role: "Scheduler",
      job: "Proposes the day on Google Calendar.",
    },
    {
      id: "critic",
      name: "Critic",
      role: "Reviewer",
      job: "Scores the plan and sends a failure back to Atlas, or approves it.",
    },
    {
      id: "executor",
      name: "Executor",
      role: "Drafter",
      job: "Writes the calendar, email, and Slack drafts, and does not send them.",
    },
    {
      id: "brief",
      name: "Brief",
      role: "Writer",
      job: "Turns the approved plan into three outcomes and the call card.",
    },
  ];
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
          <strong>Atlas</strong>
          ${connectorIcons()}
        </div>
        <nav class="tabs" aria-label="Demos">
          <button type="button" data-tab="war" aria-pressed="true">War room</button>
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
        <p class="kicker">Context</p>
        <h2>How a support analyst keeps the morning.</h2>
        <p>This is one Tuesday for Jordan Hale, a client-support analyst who also holds time to build CaseFlow and to take a short walk. Atlas is the head agent. Research reads the company in HubSpot, the planner rewrites the day on the calendar, and the executor drafts the Slack note. Nothing is sent. The war room below is the hard morning, an escalation at 8:47. Day plan and Brief are that same morning before the email.</p>
        <ul class="benefits">
          <li>
            <strong>The morning stays usable.</strong>
            <span>Focus time and the wellness walk survive a calendar that was already double-booked.</span>
          </li>
          <li>
            <strong>A bad plan gets rejected.</strong>
            <span>The first schedule clears every client call and loses the morning. The critic sends it back.</span>
          </li>
          <li>
            <strong>You walk in prepared.</strong>
            <span>The call card, the email, and the Slack note are drafted from the company record. You choose what goes out.</span>
          </li>
        </ul>
      </section>
      <section class="org" id="org" aria-label="Agents reporting to Atlas">
        <p class="kicker">Orchestration</p>
        <h2>These agents report to Atlas.</h2>
        <p class="org-lead">Atlas is the head agent. It does not do the specialist work. It decides who goes next, and a rejection comes back to Atlas before the planner tries again.</p>
        <div class="org-chart">
          <article class="org-head" data-agent="supervisor">
            <strong>Atlas</strong>
            <span class="role">Head agent</span>
            <span class="job">Routes the team and hands the job to one specialist at a time.</span>
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
          <li>Research</li>
          <li>Planner</li>
          <li>Critic</li>
          <li>Executor</li>
          <li>Brief</li>
        </ol>
        <p class="org-return">If the critic rejects the plan, it goes back to Atlas, and Atlas sends the planner again.</p>
      </section>
      <section id="view-war">
        <div class="lede">
          <div>
            <h1>An escalation at 8:47.</h1>
            <p>${esc(state.dateLabel)}. ${esc(state.persona)} already has a double-booked morning. HubSpot holds the company record, the day is on Google Calendar, and the note is ready for Slack. Press play and the swarm rewrites the day.</p>
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
        <p class="note">The chart above is this run. Press play and the agent Atlas has called lights up. Specialists do not call each other. A rejection comes back to Atlas, then the planner tries again.</p>
        <div id="board"></div>
        <div class="split" id="split">
          <div>
            <p class="column-label">The email and the swarm</p>
            <article class="card ask">
              <p class="kicker">${mail ? esc(mail.at) + " · " + esc(mail.from) : "Inbox"}</p>
              <h2>${mail ? esc(mail.subject) : "No escalation"}</h2>
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
        <a href="https://github.com/saltylvn/agentic-workflows">Source</a>
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
    cursor = war.trace.length;
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
    if (tab !== "war") return;
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
  if (next !== "war") pause();
  for (const name of ["war", "plan", "brief"] as const) {
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
  if (name === "war" || name === "plan" || name === "brief") return name;
  return null;
}

function play(): void {
  if (cursor >= war.trace.length) cursor = 0;
  playing = true;
  window.clearInterval(timer);
  timer = window.setInterval(() => {
    if (cursor >= war.trace.length) {
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
  const done = !playing && cursor >= war.trace.length;
  const playButton = document.querySelector<HTMLButtonElement>("#play");
  const lede = document.querySelector(".lede");
  if (playButton) playButton.textContent = playing ? "Pause" : done ? "Play demo" : "Play";
  lede?.classList.toggle("is-done", done);
}

function advance(): void {
  if (cursor < war.trace.length) cursor += 1;
  if (cursor >= war.trace.length) playing = false;
  frame();
}

function frame(): void {
  const revealed = war.trace.slice(0, cursor);
  const activeIndex = pickedStep != null && pickedStep < cursor ? pickedStep : cursor - 1;
  const active = activeIndex >= 0 ? war.trace[activeIndex] : undefined;
  const approved = revealed.some((event) => event.agent === "critic" && /approved/i.test(event.title));
  const rejected = revealed.some((event) => event.agent === "critic" && /rejected/i.test(event.title));
  syncPlayButton();
  byId("count").textContent = `${cursor} / ${war.trace.length}`;
  byId("rail").innerHTML = rail(active);
  const seen = new Set<string>(revealed.map((event) => event.agent));
  document.querySelectorAll<HTMLElement>("[data-agent]").forEach((node) => {
    const id = node.dataset.agent ?? "";
    const working = id === active?.agent && revealed.length > 0;
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
      ? `<li class="step"><span class="who supervisor">Supervisor</span> <strong>Waiting to open the war room.</strong></li>`
      : revealed
          .map((event, index) => stepHtml(event, index, index === activeIndex))
          .join("");
  const trace = byId("trace");
  const latest = trace.querySelector<HTMLElement>(".is-latest, .is-picked");
  if (playing && latest) {
    const top = latest.offsetTop - trace.offsetTop;
    trace.scrollTo({ top: Math.max(0, top - 8) });
  }
  const blocks = approved ? viewsFromPlan(war) : viewsFromEvents(war.events);
  byId("board").innerHTML = boardHtml(blocks, approved, rejected);
  const side = sideHtml(revealed);
  byId("side").innerHTML = side;
  byId("split").classList.toggle("is-single", side.trim() === "");
}

function rail(active: TraceEvent | undefined): string {
  const bad = active?.agent === "critic" && /rejected/i.test(active.title);
  const good = active?.agent === "critic" && /approved/i.test(active.title);
  return PIPELINE.map((agent) => {
    const on = active?.agent === agent;
    const cls = ["", on ? "is-on" : "", on && bad ? "is-bad" : "", on && good ? "is-good" : ""]
      .filter(Boolean)
      .join(" ");
    return `<li class="${cls}"><span class="dot"></span>${esc(label(agent))}</li>`;
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
  const failure = war.critiques[0]?.failures[0];
  const selected = blocks.find((block) => block.id === pickedBlock);
  return `
    <article class="card board">
      <p class="kicker">${approved ? "After" : "Before"}</p>
      <h2>${approved ? "The rewrite" : "Tuesday as it stands"}</h2>
      <p class="caption">${approved ? "Critic approved. Focus stays in the morning." : "Northwind is sitting on the focus block."}</p>
      ${scheduleHtml(blocks)}
      ${
        rejected && !approved && failure
          ? `<p class="callout"><strong>${esc(String(war.critiques[0]?.score ?? ""))}/100 · ${esc(failure.code)}</strong>${esc(failure.detail)}</p>`
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
    ${showBrief && war.brief ? briefCard(war.brief.headline, war.brief.outcomes, war.brief.callCard) : ""}
    ${showDrafts ? draftsHtml(war) : ""}
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
  const original = war.events.find((event) => event.id === block.id);
  let movement = "Already on the book.";
  if (approved && original && (original.start !== block.start || original.end !== block.end)) {
    movement = `Moved from ${range(original.start, original.end)}.`;
  } else if (approved && !original) {
    movement = "Added for the escalation.";
  } else if (approved && original) {
    movement = "Held.";
  }
  return `
    <div class="why">
      <strong>${esc(block.title)}</strong>
      <p class="when">${esc(range(block.start, block.end))} · ${esc(movement)}</p>
      <p>${esc(block.reason || original?.notes || "On the calendar before the swarm runs.")}</p>
    </div>
  `;
}

function renderPlan(state: RunState): void {
  const before = viewsFromEvents(state.events);
  const after = viewsFromPlan(state);
  const clashes = findOverlaps(state.events);
  const focusBlock = state.plan?.blocks.find((block) => block.id === "focus");
  const northwind = state.plan?.blocks.find((block) => block.id === "northwind");
  const proposed =
    focusBlock && northwind
      ? `Focus stays ${range(focusBlock.start, focusBlock.end)}. Northwind moves to ${range(northwind.start, northwind.end)}.`
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
        <p>Written before the 8:47 escalation. The war room call card stays on the first tab.</p>
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
  const weekday = match?.[1]?.slice(0, 3) ?? "Tue";
  const date = match?.[2] ?? "10";
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
      reason: event.notes ?? "On the calendar before the swarm runs.",
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
  if (block.id === "meridian") return "urgent";
  if (block.kind === "prep") return "prep";
  return block.kind;
}

function strategyLabel(strategy: string): string {
  return strategy === "protect-focus" ? "Protect focus" : "Client-first";
}

function label(agent: string): string {
  if (agent === "supervisor") return "Atlas";
  if (agent === "researcher") return "Research";
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
