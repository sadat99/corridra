// Fair pages (Lane 12 of the UX update). This list is empty on purpose: a date goes in only after a
// person in the Corridra team has read it on the fair's own site, and the entry says who and when. A
// date is never worked out from last year's fair or guessed. An entry that breaks the rules in
// lib/fairs.ts is not shown and a test fails.
export type FairDateKind = 'opens' | 'closes' | 'registrationCloses';

export type FairDate = {
  kind: FairDateKind;
  /** The date as the fair states it (YYYY-MM-DD), or null when the fair has not announced it yet. */
  on: string | null;
  /** The address of the page on which the fair states it. */
  source: string;
  /** Who in the Corridra team read it there, and on which day (YYYY-MM-DD). */
  verifiedBy: string;
  verifiedOn: string;
};

export type Fair = {
  slug: string;
  name: string;
  city: string;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string;
  /** The fair's own site. */
  website: string;
  dates: readonly FairDate[];
};

export const fairs: readonly Fair[] = [];
