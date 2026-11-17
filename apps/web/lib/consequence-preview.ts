// What happens when you send this (visual grammar PR 5, V3-05-033). One entry per line of the preview on the evidence
// reply, each with the database fact that makes it true. A line with no fact does not exist: the preview never claims
// a reader, a window or an effect the code does not enforce. It only informs. The request the Send button makes is
// untouched.
import type { MessageKey } from './i18n/messages';

export type ConsequenceFact = {
  /** The line's label word. */
  label: MessageKey;
  /** The line's sentence (the link's own end date follows the last one). */
  body: MessageKey;
  /** The code fact behind it, as `path:function or line`. */
  sourceNote: string;
};

export const evidenceReplyFacts: readonly ConsequenceFact[] = [
  {
    // app.delivery_respond stores exactly the typed body (3 to 2000 characters) and returns claimStatus
    // 'self_declared'; the page already says so after sending.
    label: 'consequence.what',
    body: 'consequence.whatBody',
    sourceNote:
      'packages/db/migrations/0016_scoped_delivery.sql:198-200 (app.delivery_respond, INSERT ... body, returns self_declared)',
  },
  {
    // One row per request: a retry with a different id, link or body raises 'Response already recorded or retry
    // changed', and a request the team closed raises 'Request closed'.
    label: 'consequence.once',
    body: 'consequence.onceBody',
    sourceNote:
      'packages/db/migrations/0016_scoped_delivery.sql:192-196 (app.delivery_respond, Request closed, Response already recorded or retry changed)',
  },
  {
    // The link opens only while expires_at>now() and no delivery_revocation row names it, in the real-use
    // definition that replaced the first one. Other conditions (the mission's retention, a withdrawn publication,
    // 0009:40) can end it sooner, so the page says "at most" and never promises a window.
    label: 'consequence.until',
    body: 'consequence.untilBody',
    sourceNote:
      'packages/db/customer-real-use-migrations/0009_real_report_links.sql:23-24 (app.delivery_authorized, expires_at>now(), delivery_revocation)',
  },
];
