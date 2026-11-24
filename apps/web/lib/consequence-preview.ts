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

// Before You Save on the guided Connect AI screen (ADR-089), the third Before Send surface. Its words are the screen's
// own English lines (apps/web/app/operator/connect-ai-copy.ts, staff-facing, not translated); the rows here fix their
// order, icon and the code fact behind each. A row with no fact does not exist.
export type AiConnectionRow = {
  id: 'change' | 'money' | 'run';
  icon: 'document' | 'shield' | 'lock';
  sourceNote: string;
};

export const aiConnectionRows: readonly AiConnectionRow[] = [
  {
    // A save writes max(version)+1 for the key; a run is authorized only by the latest version of a key.
    id: 'change',
    icon: 'document',
    sourceNote:
      'packages/intelligence/src/service.ts:connect (version latest+1, VERSION_CHANGED), and packages/db/migrations/0026_governed_intelligence.sql:39 (app.ai_run_authorized, latest version of a key only)',
  },
  {
    // The save inserts one ai_model_policy row and nothing else; no payment, ledger or budget row is written.
    id: 'money',
    icon: 'shield',
    sourceNote:
      'packages/intelligence/src/service.ts:insertPolicy (one app.ai_model_policy INSERT, no other write)',
  },
  {
    // The save itself: no provider call and no ai.enabled config_version, in any workspace and in either state below.
    // Real workspaces after ADR-091 (which amends ADR-089 decision 5): a control that starts closed, then the owner's
    // own ai.enabled setting written after the first opening. While either is off no run can start. Once both are on
    // a later run can use the connection, and the checks named in the on-state sentence still refuse or bound it.
    id: 'run',
    icon: 'lock',
    sourceNote:
      'packages/intelligence/src/service.ts:insertPolicy (one app.ai_model_policy INSERT, no provider call, no config_version write), and docs/adr/0091-ai-assistance-in-real-workspaces.md:Decision 5. Off: packages/db/ai-model-policy-real-migrations/0002_real_workspace_runs.sql:51-54 (app.ai_real_runs_open, closed with no row), 0002_real_workspace_runs.sql:111-116 (app.part4_enabled, ai.enabled true in a real workspace only while the control is open and the setting was written after the first opening), packages/intelligence/src/service.ts:run (AI_REAL_OFF, 403). On: packages/db/migrations/0026_governed_intelligence.sql:39 (app.ai_run_authorized, route pack names the policy, no email address or phone number in a cited statement), 0002_real_workspace_runs.sql:69 (APPROVED_PROVIDER evaluation in a real workspace), 0002_real_workspace_runs.sql:72 and packages/intelligence/src/index.ts:161-163 (contact details and long numbers refuse the run), 0002_real_workspace_runs.sql:92 (per run cost limit, daily budget, two attempts), 0002_real_workspace_runs.sql:106 (review by owner, admin, operator or reviewer with a fresh authenticator check)',
  },
];

/** The closing line under Before You Save: who saved it and why is kept on the row and its record_change event. */
export const aiConnectionRecordedFact = {
  sourceNote:
    'packages/intelligence/src/service.ts:insertPolicy (created_by, reason), and packages/db/migrations/0026_governed_intelligence.sql:110 (app.record_change event)',
} as const;
