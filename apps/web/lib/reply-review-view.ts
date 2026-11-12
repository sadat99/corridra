// The words and pure helpers the staff review queue uses (ADR-069). Kept apart from the screen so they
// can be tested without a browser.
import { currencies } from '@corridra/domain/currencies';
import { displayMoney } from '@corridra/domain/locale';
import type {
  ReplyBody,
  ReplyPrefillReason,
  ReplyQuotationPrefill,
  ReplyReviewReason,
  ReplyTermName,
} from '@corridra/domain/reply-review';
import { replyTermNames } from '@corridra/domain/reply-review';

export type EligiblePrefill = Extract<ReplyQuotationPrefill, { eligible: true }>;

export const termLabels: Record<ReplyTermName, string> = {
  specification: 'Specification',
  quantity: 'Quantity',
  moq: 'Minimum order',
  unit: 'Unit',
  unitPriceMinor: 'Unit price',
  totalPriceMinor: 'Total price',
  toolingMinor: 'Tooling',
  setupMinor: 'Set-up',
  packagingMinor: 'Packaging',
  leadTime: 'Lead time',
  validUntil: 'Valid until',
  incoterm: 'Trade term',
  shipping: 'Shipping',
  warranty: 'Warranty',
  installation: 'Installation',
  training: 'Training',
  spares: 'Spare parts',
  commissioning: 'Commissioning',
  paymentTerms: 'Payment terms',
};
export const reasonLabels: Record<ReplyReviewReason, string> = {
  NOT_A_FIT: 'Not a fit for this requirement',
  PRICE_NOT_CREDIBLE: 'Price not credible',
  TOO_INCOMPLETE: 'Too incomplete to use',
  DUPLICATE: 'Duplicate of another reply',
  UNCLEAR: 'Unclear',
  OTHER: 'Other (explain in the note)',
};

/** The words for one stored term: money in its original currency, a day, or the text as written. */
export function termText(key: ReplyTermName, value: string | undefined, currency: string) {
  if (value === undefined) return 'Not stated';
  if (key.endsWith('Minor')) return displayMoney(value, currency);
  if (key === 'validUntil') return value.slice(0, 10);
  return value;
}

/** Minor units as the decimal amount the quotation form takes, with exact integer arithmetic. */
export function minorToMajor(value: string, code: string) {
  const places = Object.hasOwn(currencies, code) ? currencies[code as keyof typeof currencies] : 2;
  if (places === 0) return value;
  const padded = value.padStart(places + 1, '0');
  return `${padded.slice(0, -places)}.${padded.slice(-places)}`;
}

/**
 * A prepared quotation as plain lines named like the fields of the existing quotation form, so the team
 * copies them across and confirms. Only terms the supplier gave are listed; a blank stays blank.
 */
export function preparedQuotation(reply: ReplyBody) {
  const quotation = reply.quotation;
  if (!quotation?.terms) return null;
  // The supplier's text may hold line breaks. Each value is kept to one line, so nothing a supplier types can
  // add a line of its own (for example a `source:` line) to the block the team copies.
  const oneLine = (value: string) => value.replace(/[\r\n\u2028\u2029\u0085]+/g, ' ');
  const currency = quotation.currency ?? '';
  const lines = [`currency: ${currency}`];
  for (const key of replyTermNames) {
    const value = quotation.terms[key];
    if (value === undefined) continue;
    lines.push(
      key.endsWith('Minor')
        ? `${key.slice(0, -5)}: ${minorToMajor(value, currency)}`
        : `${key}: ${oneLine(value)}`,
    );
  }
  lines.push(`uncertainties: ${oneLine(quotation.uncertainties ?? '')}`);
  lines.push('source: supplier reply, self-declared');
  return lines.join('\n');
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** True only for a well-formed id, so a link's `reply` value is checked before any request is made. */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && uuidPattern.test(value);

// Fixed words for each reason the prepared offer is refused (ADR-081). Nothing the supplier wrote reaches these.
const prefillMessages: Record<ReplyPrefillReason, string> = {
  NOT_FOUND:
    'This reply could not be found. Refresh the list. If it is still missing, ask the Corridra team.',
  NOT_PUBLISHED: 'Publish this reply first. Then you can prepare an offer from it.',
  REJECTED:
    'This reply was rejected, so no offer can be prepared. Ask the supplier again, or record your own offer.',
  ASKED_ONLY:
    'You asked the supplier a question about this reply. Wait for the answer, then review it again. Or record your own offer.',
  ALREADY_RECORDED: 'This reply is already recorded as an offer.',
  NO_QUOTATION:
    'This reply has no price or terms to record. Ask the supplier for a quote, or record your own offer.',
  REVIEW_CLOSED: 'This review is closed. Ask the supplier again, or record your own offer.',
  MISSION_CLOSED: 'This mission is closed. No new offer can be recorded here.',
  REQUIREMENT_SUPERSEDED:
    'The request changed after this reply. Ask the supplier to answer the new request, or record your own offer.',
  CURRENCY_NOT_ON_ROUTE:
    'This reply uses a currency this route does not accept. Ask the supplier to quote again in an accepted currency, or record your own offer.',
  TERM_NOT_RECORDABLE:
    'One term in this reply cannot be recorded as sent. Ask the supplier to clarify, or record your own offer.',
};
export const prefillFailureMessage =
  'We could not check this reply. Nothing was changed. Try again, or copy the prepared quotation.';
export const prefillUnavailableMessage =
  'Prepared offers are not available yet on this system. Copy the prepared quotation below and use it to fill the form by hand.';
export const prefillDeniedMessage =
  'You can review this reply, but only an owner, admin or operator can record an offer from it.';
export const prefillMessage = (code: string) =>
  Object.hasOwn(prefillMessages, code)
    ? prefillMessages[code as ReplyPrefillReason]
    : prefillFailureMessage;

/**
 * One row per known term, in the review order. The text is the supplier's exact string (money by exact integer
 * arithmetic in its original currency); a term the supplier did not give reads "Not stated", never zero.
 */
export function termRows(prefill: Pick<EligiblePrefill, 'terms' | 'currency'>) {
  return replyTermNames.map((key) => {
    const value = prefill.terms[key];
    let text: string;
    try {
      text = termText(key, value, prefill.currency);
    } catch {
      // A currency this build does not know: show the exact amount and the code, never a guess.
      text = `${value} ${prefill.currency}`;
    }
    return { key, label: termLabels[key], text, missing: value === undefined };
  });
}
