import type { AgentId } from "../types.js";

/** Short role cards. The demo runs on policy; these are the contracts a model would inherit. */
export const ROLES: Record<Exclude<AgentId, "supervisor">, string> = {
  intake:
    "Read the calendar and the inbox. Put conflicts, deadlines, and protected blocks on the board. Do not propose a schedule.",
  researcher:
    "Look up only the accounts this day will touch. Separate what we know, what we must ask, and what we must not promise.",
  planner:
    "Propose one schedule. First try may clear client calls early. If the critic rejects the focus block, reserve morning focus before non-critical meetings.",
  critic:
    "Score the plan against the rules. Do not quietly fix it. Name the failure and hand it back, or approve it.",
  executor:
    "Turn an approved plan into calendar, email, and Slack drafts. Never send.",
  brief:
    "Write the morning brief from the approved plan and the research notes. Three outcomes, one call card, no new commitments.",
};
