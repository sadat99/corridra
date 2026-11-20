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
    // One row per request: a closed request and a different second response are both refused (lines 192 to 196).
    label: 'consequence.what',
    body: 'consequence.whatBody',
    sourceNote:
      'packages/db/migrations/0016_scoped_delivery.sql:192-200 (app.delivery_respond, refusals, INSERT body, self_declared)',
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

// Before Send (Wave 3 unit 09, owner approved 20 November 2026): the same facts, shown as three rows directly above a
// Send. Each row names the code fact behind it, and a row with no fact does not exist. On the recipient reply the
// "What is sent" and "Until when" sentences are the reply page's own words (receiptSource and the expiry line in
// lib/reply-words.ts), so nothing is claimed that the page does not already say.
export type BeforeSendSurface = 'evidenceReply' | 'recipientReply';

export type BeforeSendRow = {
  id: 'who' | 'sent' | 'until';
  /** An icon name from the Corridra family (components/corridra-icon.tsx). */
  icon: 'people' | 'document' | 'clock';
  /** The row's question, an existing word of the "Who can see it" or "What happens" groups. */
  question: MessageKey;
  /** The code fact behind the row, as `path:function or line`. */
  sourceNote: string;
};

const evidenceUntilSource = evidenceReplyFacts[1].sourceNote;

export const beforeSendRows: Record<BeforeSendSurface, readonly BeforeSendRow[]> = {
  evidenceReply: [
    {
      id: 'who',
      icon: 'people',
      question: 'privacy.heading',
      sourceNote:
        'apps/web/lib/privacy-label.ts:surfaces.evidenceReply (each reader has its own sourceNote)',
    },
    {
      id: 'sent',
      icon: 'document',
      question: 'consequence.what',
      sourceNote: evidenceReplyFacts[0].sourceNote,
    },
    { id: 'until', icon: 'clock', question: 'consequence.until', sourceNote: evidenceUntilSource },
  ],
  recipientReply: [
    {
      id: 'who',
      icon: 'people',
      question: 'privacy.heading',
      sourceNote:
        'apps/web/lib/privacy-label.ts:surfaces.recipientReply (each reader has its own sourceNote)',
    },
    {
      id: 'sent',
      icon: 'document',
      question: 'consequence.what',
      sourceNote:
        'apps/web/lib/reply-words.ts:receiptSource, and packages/db/migrations/0025_scoped_product_experience.sql:app.recipient_detail_view',
    },
    {
      id: 'until',
      icon: 'clock',
      question: 'consequence.until',
      sourceNote:
        'apps/web/lib/reply-receipt.ts:expiryLine, and packages/db/migrations/0025_scoped_product_experience.sql:app.communication_allowed (c.expires_at>now())',
    },
  ],
};

/**
 * The second sentence of the evidence "What is sent" line, shown on its own with a lock. Only the evidence reply has it:
 * there a closed request and a different second response are refused. On the recipient reply a correction exists
 * (Change My Answer), so the sentence is not shown there.
 */
export const oneResponseFact = {
  surface: 'evidenceReply',
  body: 'consequence.oneResponse',
  sourceNote: evidenceReplyFacts[0].sourceNote,
} as const satisfies { surface: BeforeSendSurface; body: MessageKey; sourceNote: string };
