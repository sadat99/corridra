// The Source room's comparison (approved work rooms, 5 Nov 2026): the approved offers side by side, one column
// per supplier, in the currency each one quoted. Pure, so every rule is tested without a browser. It adds no
// verdict and no number of its own: verdicts come from the comparison engine through experience-offers.ts, the
// words of each cell from quote-cards.ts (the same cards the report page shows), and a missing term stays
// missing (null), never zero.
import type { MissionExperience } from '@corridra/delivery/report';
import { compareExperienceOffers, isCurrentOffer } from './experience-offers';
import { quoteCardsFrom, type FactName } from './quote-cards';

export type LedgerColumn = {
  id: string;
  supplier: string;
  supplierLang?: string;
  place?: string;
  /** The supplier's quote version and the currency it was quoted in, so two quotes are never mistaken for one. */
  revision: number;
  currency: string;
  /** Source kind and claim status exactly as the approved report states them; shown when there is no fact label. */
  provenance: string;
  trust: FactName | null;
  comparable: boolean;
  reason?: string;
  /** Superseded, from an earlier assignment, or the request changed since: shown only when asked for. */
  historical: boolean;
  /** "Quoted 11 Nov 2026 · Source ref 3f9a2c1d", or absent when the approved detail does not carry it. */
  reference?: string;
};
export type LedgerCell = {
  value: string | null;
  sub?: string;
  /** Shipping the price leaves out: the value keeps the stored word, the comparison draws the striped fill. */
  excluded?: true;
  /** An amount in the offer's own currency. */
  money?: true;
};
export type LedgerRow = {
  label: string;
  cells: LedgerCell[];
  /** One of the key rows shown first; the others are behind "See all terms". */
  key: boolean;
  /** The suppliers do not all say the same thing here. */
  differs: boolean;
  /**
   * Differences Only may fold this row: every quote states it, none leaves it Not stated or excluded, every value
   * reads the same, and an amount is never called the same across different currencies.
   */
  same: boolean;
};
export type Ledger = {
  columns: LedgerColumn[];
  rows: LedgerRow[];
  comparable: number;
  notComparable: number;
  /** Offers left out because they are earlier or no longer current. */
  earlier: number;
  /** How many of the shown quotes say shipping is excluded from the price. */
  shippingExcluded: number;
};

/** The rows a buyer reads first, after the price. Machinery obligations are always among them. */
const keyLabels = [
  'Incoterm',
  'Lead time',
  'Installation',
  'Commissioning',
  'Warranty',
  'Training',
  'Spares',
];

export function sourceLedger(
  e: MissionExperience,
  options: { includeEarlier?: boolean; language?: string; at?: string } = {},
): Ledger {
  const verdicts = compareExperienceOffers(e, options.at);
  const chosen = e.quotations
    .map((offer, index) => ({ offer, verdict: verdicts[index]! }))
    .filter(({ offer }) => options.includeEarlier || isCurrentOffer(e, offer));
  const cards = quoteCardsFrom({
    offers: chosen.map((c) => c.offer),
    verdicts: chosen.map((c) => c.verdict),
    shortlist: e.shortlist,
    language: options.language,
  });
  const columns: LedgerColumn[] = cards.map((card) => ({
    id: card.id,
    supplier: card.supplier,
    supplierLang: card.supplierLang,
    place: card.place,
    revision: card.revision,
    currency: card.currency,
    provenance: card.provenance,
    trust: card.trust,
    comparable: card.comparable,
    reason: card.reason,
    historical: card.historical,
    reference: card.reference,
  }));

  const term = (cardIndex: number, label: string) =>
    cards[cardIndex]!.terms.find((t) => t.label === label);
  const value = (cardIndex: number, label: string) => {
    const found = term(cardIndex, label);
    // Shipping the price leaves out keeps the stored word here, so it is neither "not stated" nor equal to it.
    return found?.state === 'excluded' ? 'EXCLUDED' : (found?.value ?? null);
  };
  const cellFor = (cardIndex: number, label: string): LedgerCell => {
    const found = term(cardIndex, label);
    return {
      value: value(cardIndex, label),
      ...(found?.state === 'excluded' ? { excluded: true as const } : {}),
      ...(found?.money ? { money: true as const } : {}),
    };
  };
  const differs = (cells: LedgerCell[]) =>
    cells.length > 1 && new Set(cells.map((c) => `${c.value ?? ''}|${c.sub ?? ''}`)).size > 1;
  const sameCurrency = columns.every((column) => column.currency === columns[0]?.currency);
  // The fold rule of lib/term-diff.ts, applied to the ledger's cells.
  const same = (cells: LedgerCell[]) =>
    cells.length > 1 &&
    cells.every(
      (c) => !c.excluded && c.value !== null && c.value !== undefined && c.value !== '',
    ) &&
    (sameCurrency || !cells.some((c) => c.money)) &&
    !differs(cells);

  const rows: LedgerRow[] = [];
  // Every amount exactly as the supplier stated it, in two rows (UI/UX.v4 row "Compare"): the unit price, and the
  // total with the quantity it is for. A total stated without a unit price is still shown in its own row (guardian
  // review of PR 314); only the part a supplier did not state says Not stated.
  const unitCells: LedgerCell[] = cards.map((card) =>
    card.unitPrice !== null ? { value: card.unitPrice, money: true } : { value: null },
  );
  const totalCells: LedgerCell[] = cards.map((card, i) => {
    if (card.total === null) return { value: null };
    const quantity = value(i, 'Quantity');
    return { value: card.total, money: true, ...(quantity ? { sub: `For ${quantity}` } : {}) };
  });
  for (const [label, cells] of [
    ['Original unit price', unitCells],
    ['Original total', totalCells],
  ] as const)
    rows.push({ label, cells, key: true, differs: differs(cells), same: same(cells) });
  const labels: string[] = [];
  for (const card of cards)
    for (const term of card.terms) if (!labels.includes(term.label)) labels.push(term.label);
  const ordered = [
    ...keyLabels.filter((l) => labels.includes(l)),
    ...labels.filter((l) => !keyLabels.includes(l)),
  ];
  for (const label of ordered) {
    const cells = cards.map((_, i) => cellFor(i, label));
    rows.push({
      label,
      cells,
      key: keyLabels.includes(label),
      differs: differs(cells),
      same: same(cells),
    });
  }
  const comparable = columns.filter((c) => c.comparable).length;
  return {
    columns,
    rows,
    comparable,
    notComparable: columns.length - comparable,
    earlier: options.includeEarlier ? 0 : e.quotations.length - chosen.length,
    shippingExcluded: cards.filter((card) => card.terms.some((t) => t.state === 'excluded')).length,
  };
}
