import { findOverlaps } from "../src/schedule/gaps.js";
import { runWorkflow } from "../src/orchestrator/supervisor.js";
import { WORK_END, WORK_START, range } from "../src/time.js";
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

function hubspotMark(): string {
  return `<svg class="hubspot" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF7A59" d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.978v-.067A2.2 2.2 0 0 0 17.238.845h-.067a2.2 2.2 0 0 0-2.193 2.193v.067a2.196 2.196 0 0 0 1.252 1.973V7.93a6.22 6.22 0 0 0-2.969 1.31L5.434 3.145a2.499 2.499 0 0 0 .08-.64 2.58 2.58 0 1 0-2.58 2.58c.48 0 .93-.132 1.31-.36l7.697 5.99a6.176 6.176 0 0 0 .077 7.172l-2.304 2.304a2.056 2.056 0 0 0-.607-.097 2.066 2.066 0 1 0 2.066 2.066 2.05 2.05 0 0 0-.097-.607l2.272-2.272a6.197 6.197 0 1 0 4.816-10.0zm-.931 9.3a3.11 3.11 0 1 1 0-6.221 3.11 3.11 0 0 1 0 6.221z"/></svg>`;
}

function shell(state: RunState): string {
  const mail = state.inbox[0];
  return `
    <header class="top">
      <div class="wrap top-inner">
        <div class="brand">
          <strong>Atlas</strong>
          <span class="crm" title="Company and contact records are read from HubSpot">
            ${hubspotMark()}
            <span>HubSpot</span>
            <span class="connected">Connected</span>
          </span>
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
        <h2>A support day, planned from the calendar and HubSpot.</h2>
        <p>Atlas is a small team of agents for the hour before the day gets away from you. It reads the calendar and the company records already in HubSpot, then decides what to move, what to protect, and what to say before a hard client call. This page is one sample Tuesday. Nothing is sent.</p>
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
            <span>The call card, the email, and the Slack note are drafted from the HubSpot record. You choose what goes out.</span>
          </li>
        </ul>
      </section>
      <section id="view-war">
        <div class="lede">
          <div>
            <h1>An escalation at 8:47.</h1>
            <p>${esc(state.dateLabel)}. ${esc(state.persona)} already has a double-booked morning. Company and contact records are read from HubSpot. Press play and the swarm rewrites the day.</p>
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
        <p class="note">The supervisor is the only router. Specialists share one blackboard and do not call each other. A rejection is a handoff back to the planner.</p>
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
      <ul class="agenda">
        ${blocks
          .map(
            (block) =>
              `<li><time>${esc(range(block.start, block.end))}</time>${esc(SHORT[block.title] ?? block.title)}</li>`,
          )
          .join("")}
      </ul>
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
      <p class="kicker">Brief · ${hubspotMark()} HubSpot</p>
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

function scheduleHtml(blocks: BlockView[]): string {
  const lanes = Math.max(1, ...blocks.map((block) => block.lane + 1));
  const height = lanes * 40 + 8;
  return `
    <div class="track-wrap">
      <div class="hours"><span>08:30</span><span>11:00</span><span>13:30</span><span>16:00</span><span>17:30</span></div>
      <div class="track" style="height:${height}px">
        ${blocks
          .map((block) => {
            const span = WORK_END - WORK_START;
            const left = ((block.start - WORK_START) / span) * 100;
            const width = Math.max(((block.end - block.start) / span) * 100, 1.2);
            const name = SHORT[block.title] ?? block.title;
            const selected = pickedBlock === block.id ? " is-selected" : "";
            const clash = block.clash ? " is-clash" : "";
            return `<button type="button" class="block ${esc(kindOf(block))}${selected}${clash}" data-block="${esc(block.id)}" style="left:${left}%;width:${width}%;top:${4 + block.lane * 40}px" title="${esc(block.title)}" aria-label="${esc(block.title)}, ${esc(range(block.start, block.end))}">${width > 7 ? esc(name) : ""}</button>`;
          })
          .join("")}
      </div>
    </div>
  `;
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
