import type { RunState, Toolkit } from "../types.js";

/** Read-only tools. Drafts are written onto the blackboard, never sent. */
export function createToolkit(state: RunState): Toolkit {
  return {
    listEvents: () => state.events,
    listInbox: () => state.inbox,
    lookupAccount: (id) => state.accounts.find((account) => account.id === id),
    accountsOnCalendar: () => {
      const ids = new Set<string>();
      for (const event of state.events) {
        if (event.accountId) ids.add(event.accountId);
      }
      for (const demand of state.demands) ids.add(demand.accountId);
      for (const mail of state.inbox) {
        if (mail.accountId) ids.add(mail.accountId);
      }
      return state.accounts.filter((account) => ids.has(account.id));
    },
  };
}
