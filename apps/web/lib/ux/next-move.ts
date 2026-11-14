// Pocket, the Next Move (UI/UX.v3 "Pocket (phone)"). One button on a phone says what to do now, picked by fixed
// rules from signals the signed-in shell already reads: nothing here reads, writes or decides access, and every
// destination is an existing page that still checks on the server. Pure, so every rule is tested without a browser.
//
// The order, first rule that fits wins:
//   1. Something waits on a decision from the person: a quote that is ready for their answer.
//   2. A draft is half done.
//   3. Nothing waits, so start a new request.
// The proposal also listed "a meeting starts within 3 hours" first and "applications waiting" under rule 2. The shell
// has no cheap read for either (meetings need one read per request; a programme carries no status in the work list),
// so those two rules are not here. They are a follow-up, never an extra read.

import { newRequestHref } from './customer-navigation';

export type PocketSignals = {
  /** Service requests whose quote is ready for the person's answer: how many, and where to review them. */
  quotes: { count: number; href: string | null };
  /** Open guided request drafts: how many, and where the newest one continues. */
  drafts: { count: number; href: string | null };
  /** The work list could not be read to its end, so a count is a floor and is drawn "N+". */
  partial: boolean;
  /** The person belongs to a workspace: New Request then opens where requests are made, otherwise the plan page. */
  hasWorkspace: boolean;
};

export type NextMoveKey = 'quotes' | 'draft' | 'new';

export type NextMove = {
  key: NextMoveKey;
  /** A Title Case action, never a sentence. */
  label: string;
  href: string;
  /** A `CorridraIcon` name. */
  icon: string;
  /** One plain sentence that says why this move is first. */
  reason: string;
  /** A small number on the button, only above zero; "N+" when the list may be longer. Null otherwise. */
  badge: string | null;
};

/** A zero is never drawn; a list that may be longer says "N+". Same rule as the sidebar's journey counts. */
export function countText(count: number, partial: boolean): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return partial ? `${Math.floor(count)}+` : String(Math.floor(count));
}

export function nextMove(signals: PocketSignals | null): NextMove {
  const quotes = signals?.quotes;
  const drafts = signals?.drafts;
  const partial = signals?.partial ?? false;
  const quoteText = quotes ? countText(quotes.count, partial) : '';
  if (quotes && quoteText && quotes.href)
    return {
      key: 'quotes',
      label: `Review ${quoteText} ${quotes.count === 1 && !partial ? 'Quote' : 'Quotes'}`,
      href: quotes.href,
      icon: 'document',
      reason:
        quotes.count === 1 && !partial
          ? 'A quote is ready for your answer.'
          : 'Quotes are ready for your answer.',
      badge: null,
    };
  const draftText = drafts ? countText(drafts.count, partial) : '';
  if (drafts && draftText && drafts.href)
    return {
      key: 'draft',
      label: 'Finish Your Draft',
      href: drafts.href,
      icon: 'draft',
      reason: 'A draft is half done and nothing is waiting on your answer.',
      badge: drafts.count > 1 || partial ? draftText : null,
    };
  return {
    key: 'new',
    label: 'New Request',
    href: newRequestHref(signals?.hasWorkspace ?? false),
    icon: 'draft',
    reason: 'Nothing is waiting on you, so this is a good moment to start a request.',
    badge: null,
  };
}
