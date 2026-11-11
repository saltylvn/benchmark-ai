import type { Portfolio } from "../portfolio/types.js";

/**
 * Summit Ridge Builders on the same fictional Thursday, seen across the whole team.
 * Every person, client, sub, address, and dollar figure is invented.
 */
export const PORTFOLIO: Portfolio = {
  company: "Summit Ridge Builders",
  today: "2026-03-12",
  people: [
    { id: "maria", name: "Maria Alvarez", role: "Project manager", slack: "@maria", capacityHours: 40 },
    { id: "jordan", name: "Jordan Pike", role: "Project manager", slack: "@jordan", capacityHours: 40 },
    { id: "renee", name: "Renee Walsh", role: "Project manager", slack: "@renee", capacityHours: 40 },
    { id: "tomas", name: "Tomas Reyes", role: "Project manager", slack: "@tomas", capacityHours: 40 },
    { id: "dave", name: "Dave Chen", role: "Owner", slack: "@dave", capacityHours: 0 },
  ],
  jobs: [
    {
      id: "J-1042", name: "Rivera kitchen", address: "123 Example Ln", client: "Sam Rivera (FAKE)",
      clientEmail: "sam.rivera@example.com", pm: "maria", stage: "quote", contract: 38450, hoursThisWeek: 9,
      lastClientUpdate: "2026-03-12", quoteDue: "2026-03-12", slackChannel: "#job-j1042",
      milestones: [
        { id: "walk", name: "Site walk", planned: "2026-03-12", done: null },
        { id: "quote", name: "Quote approved", planned: "2026-03-13", done: null },
      ],
    },
    {
      id: "J-1031", name: "Hayes basement", address: "48 Sample Ct", client: "Morgan Hayes (FAKE)",
      clientEmail: "m.hayes@example.com", pm: "maria", stage: "in-progress", contract: 62000, hoursThisWeek: 14,
      lastClientUpdate: "2026-03-05", slackChannel: "#job-j1031",
      milestones: [
        { id: "demo", name: "Demo", planned: "2026-02-16", done: "2026-02-16", billPct: 0.2, invoiced: true },
        { id: "framing", name: "Framing", planned: "2026-02-27", done: "2026-02-26", billPct: 0.2, invoiced: true },
        { id: "drywall", name: "Drywall", planned: "2026-03-11", done: "2026-03-11", billPct: 0.2, invoiced: false },
        { id: "finish", name: "Finish carpentry", planned: "2026-03-25", done: null, billPct: 0.25 },
        { id: "punch", name: "Punch list", planned: "2026-04-03", done: null, billPct: 0.15 },
      ],
    },
    {
      id: "J-1038", name: "Pinecrest addition", address: "9 Pinecrest Rd", client: "Avery Lin (FAKE)",
      clientEmail: "avery.lin@example.com", pm: "maria", stage: "in-progress", contract: 148000, hoursThisWeek: 12,
      lastClientUpdate: "2026-03-10", slackChannel: "#job-j1038",
      permit: { id: "PC-2025-0912", expires: "2026-06-30" },
      inspection: { name: "Rough-in inspection", date: "2026-03-12" },
      milestones: [
        { id: "foundation", name: "Foundation", planned: "2026-01-23", done: "2026-01-26", billPct: 0.2, invoiced: true },
        { id: "framing", name: "Framing", planned: "2026-02-20", done: "2026-02-24", billPct: 0.2, invoiced: true },
        { id: "rough", name: "Rough-in passed", planned: "2026-03-12", done: null, billPct: 0.2 },
        { id: "drywall", name: "Insulation and drywall", planned: "2026-03-27", done: null, billPct: 0.2 },
        { id: "final", name: "Final inspection", planned: "2026-04-24", done: null, billPct: 0.2 },
      ],
    },
    {
      id: "J-1027", name: "Lakeview deck", address: "302 Lakeview Dr", client: "Chris Dunn (FAKE)",
      clientEmail: "chris.dunn@example.com", pm: "jordan", stage: "closeout", contract: 24800, hoursThisWeek: 4,
      lastClientUpdate: "2026-03-09", slackChannel: "#job-j1027",
      milestones: [
        { id: "build", name: "Deck built", planned: "2026-02-27", done: "2026-02-27", billPct: 0.7, invoiced: true },
        { id: "final", name: "Final payment", planned: "2026-03-13", done: null, billPct: 0.3 },
      ],
    },
    {
      id: "J-1045", name: "Morales bath", address: "77 Demo Ave", client: "Jesse Morales (FAKE)",
      clientEmail: "jesse.morales@example.com", pm: "renee", stage: "scheduled", contract: 21500, hoursThisWeek: 8,
      lastClientUpdate: "2026-03-11", slackChannel: "#job-j1045",
      permit: { id: "PC-2026-0144", expires: "2026-09-01" },
      milestones: [
        { id: "start", name: "Demo starts", planned: "2026-03-16", done: null, billPct: 0.3 },
        { id: "tile", name: "Tile set", planned: "2026-03-27", done: null, billPct: 0.4 },
        { id: "fixtures", name: "Fixtures and punch", planned: "2026-04-03", done: null, billPct: 0.3 },
      ],
    },
    {
      id: "J-1036", name: "Patel garage", address: "15 Test St", client: "Nina Patel (FAKE)",
      clientEmail: "nina.patel@example.com", pm: "renee", stage: "in-progress", contract: 54000, hoursThisWeek: 15,
      lastClientUpdate: "2026-03-10", slackChannel: "#job-j1036",
      milestones: [
        { id: "slab", name: "Slab poured", planned: "2026-02-20", done: "2026-02-20", billPct: 0.3, invoiced: true },
        { id: "framing", name: "Framing", planned: "2026-03-13", done: null, billPct: 0.3 },
        { id: "roof", name: "Roof and doors", planned: "2026-03-27", done: null, billPct: 0.4 },
      ],
    },
    {
      id: "J-1019", name: "Cedar duplex", address: "200 Cedar Way", client: "Cedar Holdings (FAKE)",
      clientEmail: "ops@cedar.example", pm: "tomas", stage: "in-progress", contract: 410000, hoursThisWeek: 31,
      lastClientUpdate: "2026-03-11", slackChannel: "#job-j1019",
      permit: { id: "PC-2025-0533", expires: "2026-03-25" },
      milestones: [
        { id: "foundation", name: "Foundation", planned: "2025-12-12", done: "2025-12-15", billPct: 0.15, invoiced: true },
        { id: "framing", name: "Framing", planned: "2026-02-06", done: "2026-02-13", billPct: 0.2, invoiced: true },
        { id: "dryin", name: "Dried in", planned: "2026-03-06", done: null, billPct: 0.2 },
        { id: "rough", name: "Rough-ins", planned: "2026-04-03", done: null, billPct: 0.2 },
        { id: "finishes", name: "Finishes", planned: "2026-05-15", done: null, billPct: 0.25 },
      ],
    },
    {
      id: "J-1047", name: "Brooks roof", address: "61 Oak Example Pl", client: "Taylor Brooks (FAKE)",
      clientEmail: "t.brooks@example.com", pm: "tomas", stage: "lead", contract: 17800, hoursThisWeek: 6,
      lastClientUpdate: "2026-03-09", quoteDue: "2026-03-13", slackChannel: "#job-j1047",
      milestones: [{ id: "quote", name: "Quote sent", planned: "2026-03-13", done: null }],
    },
  ],
  subs: [
    { id: "brightspark", name: "Bright Spark Electric (FAKE)", trade: "Electrical", contact: "Luis Ortega (FAKE)", slack: "#subs-brightspark", coiExpires: "2026-02-28" },
    { id: "tilewright", name: "Tilewright Tile (FAKE)", trade: "Tile", contact: "Ana Ruiz (FAKE)", slack: "#subs-tilewright", coiExpires: "2026-03-20" },
    { id: "northfork", name: "North Fork Framing (FAKE)", trade: "Framing", contact: "Ben Cole (FAKE)", slack: "#subs-northfork", coiExpires: "2026-09-01" },
    { id: "clearline", name: "Clearline Plumbing (FAKE)", trade: "Plumbing", contact: "Rae Kim (FAKE)", slack: "#subs-clearline", coiExpires: "2026-11-15" },
    { id: "ridgeback", name: "Ridgeback Roofing (FAKE)", trade: "Roofing", contact: "Sol Diaz (FAKE)", slack: "#subs-ridgeback", coiExpires: "2026-07-01" },
  ],
  bookings: [
    { subId: "brightspark", jobId: "J-1038", date: "2026-03-12", task: "Rough-in walkthrough" },
    { subId: "northfork", jobId: "J-1036", date: "2026-03-13", task: "Wall framing" },
    { subId: "northfork", jobId: "J-1019", date: "2026-03-13", task: "Roof sheathing" },
    { subId: "tilewright", jobId: "J-1045", date: "2026-03-24", task: "Shower tile" },
    { subId: "clearline", jobId: "J-1031", date: "2026-03-18", task: "Fixture set" },
    { subId: "ridgeback", jobId: "J-1036", date: "2026-03-24", task: "Roofing" },
  ],
  lienWaivers: [
    { subId: "clearline", jobId: "J-1027", received: false, neededFor: "Final payment" },
    { subId: "northfork", jobId: "J-1027", received: true, neededFor: "Final payment" },
  ],
};

/**
 * The same team one morning earlier, Wednesday Mar 11. Each difference is a
 * small, ordinary overnight event so "since yesterday" has something real to show:
 *  - Sam Rivera's kitchen request (J-1042) had not come in yet.
 *  - Hayes basement drywall (J-1031) was finished Wednesday afternoon.
 *  - Jesse Morales signed the bath quote (J-1045) and got a client update.
 *  - North Fork sent the Lakeview deck lien waiver (J-1027).
 *  - North Fork was booked on the Cedar duplex for Friday, the same day as Patel garage.
 */
export const PORTFOLIO_YESTERDAY: Portfolio = (() => {
  const p: Portfolio = structuredClone(PORTFOLIO);
  p.today = "2026-03-11";
  p.jobs = p.jobs.filter((j) => j.id !== "J-1042");
  const job = (id: string) => p.jobs.find((j) => j.id === id)!;
  job("J-1031").milestones.find((m) => m.id === "drywall")!.done = null;
  job("J-1045").stage = "quote";
  job("J-1045").lastClientUpdate = "2026-03-04";
  p.lienWaivers.find((w) => w.subId === "northfork" && w.jobId === "J-1027")!.received = false;
  p.bookings = p.bookings.filter((b) => !(b.subId === "northfork" && b.jobId === "J-1019"));
  return p;
})();
