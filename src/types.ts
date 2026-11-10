/** Shared contracts for the blackboard, the tools, and the team. */

export type AgentId =
  | "intake"
  | "researcher"
  | "planner"
  | "critic"
  | "executor"
  | "brief"
  | "supervisor";

export type EventKind =
  | "standup"
  | "focus"
  | "client"
  | "internal"
  | "personal"
  | "break"
  | "admin";

export type BlockKind = EventKind | "prep";

export type Flexibility = "fixed" | "movable";

export type Strategy = "client-first" | "protect-focus";

/** Minutes from midnight. The fixture day is local time, no timezone math. */
export type Minute = number;

export interface CalendarEvent {
  id: string;
  title: string;
  kind: EventKind;
  start: Minute;
  end: Minute;
  flexibility: Flexibility;
  /** Higher means "try harder to honor the original placement." */
  priority: number;
  protected: boolean;
  /** Elastic blocks may shrink to this. Fixed-duration blocks set it equal to their length. */
  minDuration: Minute;
  needsPrepMinutes: number;
  /** Meeting (not prep) must start at or after this minute. */
  earliest: Minute;
  /** Meeting must end at or before this minute. */
  latest: Minute;
  accountId?: string;
  notes?: string;
}

export interface Demand {
  id: string;
  title: string;
  accountId: string;
  duration: Minute;
  prepMinutes: Minute;
  earliest: Minute;
  /** Meeting must end by this minute. */
  latest: Minute;
  priority: number;
  /** When a written status must be ready, as minutes from midnight. */
  statusDeadline?: Minute;
  reason: string;
}

export interface CaseRecord {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2" | "P3";
  status: string;
}

export interface Account {
  id: string;
  name: string;
  tier: "strategic" | "enterprise" | "standard";
  owner: string;
  ownerRole: string;
  ownerEmail: string;
  slackChannel: string;
  /** Next job milestone, such as a demolition day. Not a software release. */
  milestone?: string;
  lastTouch: string;
  lastTouchNote: string;
  summary: string;
  cases: CaseRecord[];
  facts: string[];
  openQuestions: string[];
  doNotPromise: string[];
}

export interface Email {
  id: string;
  at: string;
  from: string;
  fromRole: string;
  to: string;
  subject: string;
  body: string;
  accountId?: string;
  urgent: boolean;
}

export interface PlanBlock {
  id: string;
  title: string;
  kind: BlockKind;
  start: Minute;
  end: Minute;
  reason: string;
  accountId?: string;
  /** Set on prep blocks. */
  prepFor?: string;
  anchor: boolean;
}

export interface Unplaced {
  id: string;
  title: string;
  reason: string;
}

export interface Plan {
  strategy: Strategy;
  blocks: PlanBlock[];
  unplaced: Unplaced[];
  notes: string[];
}

export interface CritiqueFailure {
  code: string;
  detail: string;
  weight: number;
}

export interface Critique {
  revision: number;
  strategy: Strategy;
  approved: boolean;
  score: number;
  failures: CritiqueFailure[];
  passed: string[];
}

export interface ResearchNote {
  accountId: string;
  name: string;
  headline: string;
  summary: string;
  bullets: string[];
  questions: string[];
  doNotPromise: string[];
}

export interface Finding {
  id: string;
  source: AgentId;
  level: "info" | "warn" | "critical";
  code: string;
  summary: string;
}

export type Action =
  | {
      type: "calendar.create" | "calendar.update";
      id: string;
      title: string;
      from?: string;
      to: string;
      reason: string;
      status: "draft";
    }
  | {
      type: "slack.draft";
      channel: string;
      text: string;
      status: "draft";
    }
  | {
      type: "email.draft";
      to: string;
      subject: string;
      body: string;
      accountId: string;
      sendAt: string;
      status: "draft";
    };

export interface CallCard {
  account: string;
  when: string;
  whyNow: string;
  knows: string[];
  questions: string[];
  doNotPromise: string[];
  success: string;
}

export interface Brief {
  headline: string;
  outcomes: string[];
  watchouts: string[];
  schedule: { time: string; title: string; note: string }[];
  callCard?: CallCard;
}

export interface TraceEvent {
  at: string;
  agent: AgentId;
  title: string;
  detail: string;
  handoff?: { to: AgentId; reason: string };
}

export interface RunState {
  runId: string;
  workflow: "thursday" | "morning";
  goal: string;
  dateLabel: string;
  persona: string;
  role: string;
  /** Virtual clock, minutes from midnight, advanced by the supervisor. */
  clock: Minute;
  events: CalendarEvent[];
  demands: Demand[];
  accounts: Account[];
  inbox: Email[];
  priorities: string[];
  findings: Finding[];
  research: ResearchNote[];
  plan?: Plan;
  /** Every proposal, including ones the critic rejected. */
  attempts: Plan[];
  critiques: Critique[];
  actions: Action[];
  brief?: Brief;
  trace: TraceEvent[];
  /** Seconds past `clock`, so the trace reads in order without real waiting. */
  traceSeconds: number;
  revision: number;
  status: "running" | "approved" | "needs_human";
  modelName: string;
}

export interface Toolkit {
  listEvents(): CalendarEvent[];
  listInbox(): Email[];
  lookupAccount(id: string): Account | undefined;
  accountsOnCalendar(): Account[];
}

export interface ProseModel {
  readonly name: string;
  polish(input: { kind: "brief" | "email" | "slack"; draft: string; facts: string[] }): Promise<string>;
}
