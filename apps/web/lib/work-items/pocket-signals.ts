// What the Pocket button (the Next Move) reads from the work list the sidebar already reads: quotes that are ready for
// the person's answer and open drafts. Both are rows of the Requests page's own "Your work" list, so the numbers are
// the numbers that page shows, with the same workspace and role scoping and the same "or more" rule. Pure.
import { incomplete } from './view';
import type { WorkList } from './types';
import type { PocketSignals } from '../ux/next-move';

/** Where several quotes are reviewed together: the service requests page, which lists each with its status. */
export const quotesListHref = '/account/service-requests';

export function pocketSignalsOf(list: WorkList): PocketSignals {
  // The list is newest first, so the first draft is the one most recently worked on.
  const quotes = list.items.filter(
    (item) => item.kind === 'service_request' && item.status === 'quoted',
  );
  const drafts = list.items.filter((item) => item.kind === 'draft');
  return {
    quotes: {
      count: quotes.length,
      href: quotes.length === 1 ? quotes[0]!.href : quotes.length > 1 ? quotesListHref : null,
    },
    drafts: { count: drafts.length, href: drafts[0]?.href ?? null },
    partial: incomplete(list),
    hasWorkspace: list.workspaces.length > 0,
  };
}
