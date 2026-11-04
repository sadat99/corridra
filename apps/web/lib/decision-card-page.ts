// The public decision card page (ADR-076 item 4, docs/revamp/specs/decision-card-ui.md). Pure rules, so the
// page's words and its handling of any answer are tested without a browser. The page shows six fields and one
// message; whatever the server answered, only those can reach the screen.
import { factNameFor } from './quote-cards';
import { formatDate } from './ux/format';

export const unavailableWords = 'This link is not available.';

/** The link secret is exactly 43 base64url characters in the fragment. Anything else opens nothing. */
export function tokenFromHash(hash: string): string | null {
  const value = hash.startsWith('#') ? hash.slice(1) : '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export type CardFields = {
  company: string;
  decision: string;
  rationale: string;
  nextAction: string;
  dueAt: string;
  provenance: { sourceKind: string; claimStatus: string };
};

const isText = (value: unknown): value is string => typeof value === 'string';

/** The six fields of an open card, or null for every other answer (unknown, error, malformed, anything else). */
export function cardFromAnswer(answer: unknown): CardFields | null {
  if (!answer || typeof answer !== 'object') return null;
  const body = answer as Record<string, unknown>;
  if (body.state !== 'OPEN' || !body.card || typeof body.card !== 'object') return null;
  const card = body.card as Record<string, unknown>;
  const provenance = card.provenance as Record<string, unknown> | null | undefined;
  if (
    !isText(card.company) ||
    !isText(card.decision) ||
    !isText(card.rationale) ||
    !isText(card.nextAction) ||
    !isText(card.dueAt) ||
    !provenance ||
    !isText(provenance.sourceKind) ||
    !isText(provenance.claimStatus)
  )
    return null;
  // Picked one by one: a field the server was never meant to send cannot ride along.
  return {
    company: card.company,
    decision: card.decision,
    rationale: card.rationale,
    nextAction: card.nextAction,
    dueAt: card.dueAt,
    provenance: { sourceKind: provenance.sourceKind, claimStatus: provenance.claimStatus },
  };
}

const decisionWords: Record<string, string> = {
  SELECT: 'Selected',
  DECLINE: 'Declined',
  NEED_INFORMATION: 'More information needed',
};
export const decisionLabel = (decision: string) => decisionWords[decision] ?? decision;

/** "self_declaration · Self-declared": the source kind as written and the product's fixed name for the status. */
export const provenanceLabel = (provenance: CardFields['provenance']) =>
  `${provenance.sourceKind} · ${factNameFor(provenance.claimStatus) ?? provenance.claimStatus}`;

/** The due date in the product's date form when it is a date, otherwise as written. */
export const dueLabel = (dueAt: string) => (dueAt && formatDate(dueAt)) || dueAt;
