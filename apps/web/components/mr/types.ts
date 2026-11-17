/** Who is holding a piece of work. Fixed shapes; the word is always shown, never colour alone. */
export type Holder = 'you' | 'team' | 'owner' | 'third';
export const holders: readonly Holder[] = ['you', 'team', 'owner', 'third'];

/** The fixed list of verbs a Move can use. One verb, one object, one holder, a date only if real. */
export const moveVerbs = ['Read', 'Answer', 'Add', 'Confirm', 'Choose', 'Send'] as const;
export type MoveVerb = (typeof moveVerbs)[number];

/**
 * One labelled term on a quote card. A missing value is shown as "not stated", never zero. `state:
 * 'excluded'` marks a term the supplier says the price leaves out (shipping only), drawn as the
 * striped fill with the word "Excluded"; it carries no value.
 */
export type QuoteTerm = {
  label: string;
  value: string | null | undefined;
  state?: 'excluded';
  /** True for an amount in the offer's own currency; such a row never folds across different currencies. */
  money?: true;
};
