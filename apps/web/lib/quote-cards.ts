// The Compare lens: quote cards drawn from the approved offers and the verdicts the existing
// comparison engine (`compareOffers`) already produced. This file adds no verdict of its own. A card
// says "comparable" only when the engine says so; a reason is exactly what the engine reports (the
// missing terms, an expired offer, a total that does not match) or that the offer no longer matches
// the current request. A missing term is "not stated", never zero. Amounts stay in the original
// currency with its code, and the fact label is shown only for the five names the product uses.
import type { MissionExperience } from '@corridra/delivery/report';
import { displayDate, displayMoney } from '@corridra/domain/locale';
import type { QuoteTerm } from '../components/mr/types';

type Offer = MissionExperience['quotations'][number];
type Target = MissionExperience['shortlist'][number];
export type OfferVerdict = {
  missing: string[];
  status: string;
  inconsistentTotal?: boolean;
  expired?: boolean;
  evidenceCurrent?: boolean;
};

const termLabels: Record<string, string> = {
  specification: 'Quoted specification',
  quantity: 'Quantity',
  moq: 'Minimum order quantity',
  unit: 'Quantity unit',
  unitPriceMinor: 'Original unit price',
  totalPriceMinor: 'Original total',
  toolingMinor: 'Tooling',
  setupMinor: 'Setup',
  packagingMinor: 'Packaging',
  leadTime: 'Lead time',
  validUntil: 'Offer valid until',
  incoterm: 'Incoterm',
  shipping: 'Shipping scope',
  warranty: 'Warranty',
  installation: 'Installation',
  training: 'Training',
  spares: 'Spares',
  paymentTerms: 'Payment terms',
};
/** The terms the engine needs for a like-for-like comparison, in reading order (the prices have their own place). */
const required = [
  'specification',
  'quantity',
  'leadTime',
  'validUntil',
  'incoterm',
  'shipping',
  'paymentTerms',
  'toolingMinor',
  'setupMinor',
  'packagingMinor',
] as const;
/** Terms worth showing when the supplier gave them, though the engine does not require them. */
const optional = ['moq', 'warranty', 'installation', 'training', 'spares'] as const;

const factNames = {
  'self-declared': 'Self-declared',
  'evidence-available': 'Evidence available',
  verified: 'Verified',
  derived: 'Derived',
  'outcome-observed': 'Outcome observed',
} as const;
export type FactName = (typeof factNames)[keyof typeof factNames];

/** The product's fact name for a claim status, or null. Nothing is guessed and nothing is weakened. */
export function factNameFor(claimStatus: string): FactName | null {
  const key = claimStatus
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return (factNames as Record<string, FactName>)[key] ?? null;
}

export type QuoteCardView = {
  id: string;
  supplier: string;
  supplierLang?: string;
  place?: string;
  revision: number;
  currency: string;
  unitPrice: string | null;
  total: string | null;
  comparable: boolean;
  reason?: string;
  terms: QuoteTerm[];
  trust: FactName | null;
  provenance: string;
  /** True when the offer is superseded, assigned in the past or the requirement needs review. */
  historical: boolean;
};

const han = /\p{Script=Han}/u;

/** Why an offer is not comparable, in the engine's own terms. Empty when it is comparable. */
export function reasonFor(verdict: OfferVerdict): string {
  if (verdict.status === 'COMPARABLE ON SUPPLIED TERMS') return '';
  const parts: string[] = [];
  if (verdict.missing.length)
    parts.push(`Missing: ${verdict.missing.map((key) => termLabels[key] ?? key).join(', ')}.`);
  if (verdict.expired) parts.push('The offer has expired.');
  if (verdict.inconsistentTotal) parts.push('The total does not match unit price times quantity.');
  if (verdict.evidenceCurrent === false) parts.push('It does not match the current request.');
  if (!parts.length) parts.push('Its terms differ from the other offers.');
  return parts.join(' ');
}

export function quoteCardsFrom({
  offers,
  verdicts,
  shortlist,
  language = 'en',
}: {
  offers: Offer[];
  /** One verdict per offer, in the same order, as `compareOffers` returned them. */
  verdicts: OfferVerdict[];
  shortlist: Target[];
  language?: string;
}): QuoteCardView[] {
  return offers.map((offer, index) => {
    const verdict = verdicts[index];
    const target = shortlist.find((item) => item.id === offer.targetId);
    const money = (minor: unknown) =>
      minor === undefined || minor === null
        ? null
        : displayMoney(String(minor), offer.currency, language);
    const terms: QuoteTerm[] = [];
    const add = (key: string) => {
      const value = (offer.terms as Record<string, unknown>)[key];
      const missing = value === undefined || value === null || value === 'NOT_SUPPLIED';
      terms.push({
        label: termLabels[key] ?? key,
        value: missing
          ? null
          : key.endsWith('Minor')
            ? money(value)
            : key === 'validUntil'
              ? displayDate(String(value), 'UTC', language)
              : key === 'quantity'
                ? `${String(value)} ${String((offer.terms as Record<string, unknown>).unit ?? '')}`.trim()
                : String(value),
      });
    };
    for (const key of required) add(key);
    for (const key of optional)
      if ((offer.terms as Record<string, unknown>)[key] !== undefined) add(key);
    const trust = factNameFor(offer.claimStatus);
    const comparable = verdict.status === 'COMPARABLE ON SUPPLIED TERMS';
    return {
      id: offer.id,
      supplier: target?.company ?? 'Selected supplier',
      supplierLang: target && han.test(target.company) ? 'zh' : undefined,
      place: target?.country,
      revision: offer.revision,
      currency: offer.currency,
      unitPrice: money(offer.terms.unitPriceMinor),
      total: money(offer.terms.totalPriceMinor),
      comparable,
      reason: comparable ? undefined : reasonFor(verdict),
      terms,
      trust,
      provenance: `${offer.sourceKind} · ${offer.claimStatus}`,
      historical: offer.superseded || !offer.assignmentCurrent,
    };
  });
}
