/** The team-wide view: every job, every PM, every sub. Dates are ISO yyyy-mm-dd, local time. */

export type Stage = "lead" | "quote" | "scheduled" | "in-progress" | "closeout";

export const STAGES: { id: Stage; label: string }[] = [
  { id: "lead", label: "Lead" },
  { id: "quote", label: "Quote" },
  { id: "scheduled", label: "Scheduled" },
  { id: "in-progress", label: "In progress" },
  { id: "closeout", label: "Closeout" },
];

export interface Person {
  id: string;
  name: string;
  role: "Project manager" | "Superintendent" | "Owner";
  slack: string;
  /** Hours a week this person can carry before the plan says "heavy". */
  capacityHours: number;
}

export interface Milestone {
  id: string;
  name: string;
  planned: string;
  done: string | null;
  /** Share of the contract billed when this milestone is done, 0–1. Absent means no invoice. */
  billPct?: number;
  invoiced?: boolean;
}

export interface Job {
  id: string;
  name: string;
  address: string;
  client: string;
  clientEmail: string;
  pm: string;
  stage: Stage;
  /** Contract value in whole dollars. Totals are added by code. */
  contract: number;
  /** PM hours this week, from the job's schedule. */
  hoursThisWeek: number;
  lastClientUpdate: string;
  milestones: Milestone[];
  permit?: { id: string; expires: string };
  inspection?: { name: string; date: string; who?: string };
  quoteDue?: string;
  slackChannel: string;
}

export interface Sub {
  id: string;
  name: string;
  trade: string;
  contact: string;
  slack: string;
  coiExpires: string;
}

export interface Booking {
  subId: string;
  jobId: string;
  date: string;
  task: string;
}

export interface LienWaiver {
  subId: string;
  jobId: string;
  received: boolean;
  neededFor: string;
}

export interface Portfolio {
  company: string;
  today: string;
  people: Person[];
  jobs: Job[];
  subs: Sub[];
  bookings: Booking[];
  lienWaivers: LienWaiver[];
}

export type RiskKind =
  | "insurance"
  | "permit"
  | "inspection"
  | "lien-waiver"
  | "invoice"
  | "client-update"
  | "double-booking"
  | "late-milestone"
  | "quote-due"
  | "workload";

export interface Risk {
  id: string;
  kind: RiskKind;
  level: "blocked" | "watch";
  jobId?: string;
  owner: string;
  title: string;
  detail: string;
  due?: string;
}

export type DraftKind = "slack" | "email" | "invoice" | "reassign";

export interface Draft {
  id: string;
  kind: DraftKind;
  /** Which risk this answers. */
  riskId?: string;
  owner: string;
  to: string;
  subject: string;
  body: string;
  jobId?: string;
  amount?: number;
  /** Ledger key in dashboard/assumptions.json. */
  task: string;
  status: "draft";
}

export interface JobStatus {
  jobId: string;
  name: string;
  pm: string;
  stage: Stage;
  percent: number;
  status: "on-track" | "at-risk" | "behind";
  reason: string;
  daysLate: number;
  nextMilestone: { name: string; planned: string } | null;
  milestones: (Milestone & { state: "done" | "late" | "upcoming"; daysLate: number })[];
}

export interface Workload {
  personId: string;
  name: string;
  jobs: string[];
  hours: number;
  capacity: number;
  openRisks: number;
  load: "light" | "ok" | "heavy";
}

export interface SweepStep {
  agent: "coordinator";
  check: string;
  looked: number;
  found: number;
}

export interface Sweep {
  today: string;
  company: string;
  statuses: JobStatus[];
  risks: Risk[];
  drafts: Draft[];
  workload: Workload[];
  steps: SweepStep[];
  digest: string;
}
