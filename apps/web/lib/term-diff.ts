// Differences-only for the Compare cards (CMP1, 17 November 2026). Pure presentation: it decides which
// term rows an owner may fold behind a visible count, and adds no verdict, conversion or sum.
// A row folds ONLY when every offer states it and the formatted strings are identical. A term any offer
// omits, leaves "Not stated", marks excluded, or states differently is always shown; so is a term missing
// in every offer. Money rows never fold when the offers use different currencies.
import type { QuoteTerm } from '../components/mr/types';

export type TermDiffOffer = { currency: string; terms: QuoteTerm[] };
export type TermDiff = {
  /** Labels of the rows that may be folded, in the order the first offer lists them. */
  same: string[];
  /** Number of distinct term rows across all offers. */
  total: number;
  /** True when every row is the same in every offer (and there is at least one row). */
  allSame: boolean;
};

const empty: TermDiff = { same: [], total: 0, allSame: false };

export function termDiff(offers: TermDiffOffer[]): TermDiff {
  const labels: string[] = [];
  for (const offer of offers)
    for (const term of offer.terms) if (!labels.includes(term.label)) labels.push(term.label);
  // One offer has nothing to compare against: no control, nothing folded.
  if (offers.length < 2) return { ...empty, total: labels.length };
  const sameCurrency = offers.every((offer) => offer.currency === offers[0].currency);
  const same = labels.filter((label) => {
    const found = offers.map((offer) => offer.terms.find((term) => term.label === label));
    if (found.some((term) => !term)) return false;
    const rows = found as QuoteTerm[];
    if (rows.some((term) => term.state === 'excluded')) return false;
    if (rows.some((term) => term.money) && !sameCurrency) return false;
    const values = rows.map((term) => term.value);
    if (values.some((value) => value === null || value === undefined || value === '')) return false;
    return values.every((value) => value === values[0]);
  });
  return {
    same,
    total: labels.length,
    allSame: labels.length > 0 && same.length === labels.length,
  };
}
