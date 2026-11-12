// The plain words for the kind of a meeting or visit, from the stored activity kind the approved detail carries (real-use 0019).
// One map, so every screen says the same thing. A kind that is not listed has no word: the screen shows nothing for it, never a
// guess and never the stored code.
const words: Record<string, string> = {
  BUYER_MEETING: 'Buyer meeting',
  SUPPLIER_MEETING: 'Supplier meeting',
  FACTORY_VISIT: 'Factory visit',
  SHOWROOM_VISIT: 'Showroom visit',
  TECHNICAL_EVALUATION: 'Technical evaluation',
  INSTITUTIONAL_MEETING: 'Institutional meeting',
  TRADE_FAIR_MEETING: 'Trade fair meeting',
};

/** The plain name of a visit or meeting kind, or undefined when the kind is absent or not one the product names. */
export function visitKindWord(kind: string | undefined | null): string | undefined {
  return kind && Object.hasOwn(words, kind) ? words[kind] : undefined;
}
