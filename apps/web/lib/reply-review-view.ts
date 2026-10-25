// The words and pure helpers the staff review queue uses (ADR-069). Kept apart from the screen so they
// can be tested without a browser.
import { currencies } from '@corridra/domain/currencies';
import { displayMoney } from '@corridra/domain/locale';
import type { ReplyBody, ReplyReviewReason, ReplyTermName } from '@corridra/domain/reply-review';
import { replyTermNames } from '@corridra/domain/reply-review';

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
