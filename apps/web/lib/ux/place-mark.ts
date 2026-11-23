import type { PlaceMark } from '../../components/ux/flag';

// UI/UX.v4.1 L1: the mark that stands before a written place name. It only finds one of the nine existing flags
// (public/flags) or the neutral compass of a region; any other place, and every contested place, gets nothing. It
// never guesses: the value must be the two-letter code or one of the plain English names below. No flag is added here.
const marks: Record<string, PlaceMark> = {
  bd: 'bd',
  bangladesh: 'bd',
  cn: 'cn',
  china: 'cn',
  eu: 'eu',
  'european union': 'eu',
  gb: 'gb',
  uk: 'gb',
  'united kingdom': 'gb',
  us: 'us',
  usa: 'us',
  'united states': 'us',
  au: 'au',
  australia: 'au',
  es: 'es',
  spain: 'es',
  fr: 'fr',
  france: 'fr',
  it: 'it',
  italy: 'it',
  'key asian markets': 'region',
};

/** The mark for a place as written (a country code or its English name), or nothing when the policy names none. */
export function placeMark(value: string | null | undefined): PlaceMark {
  if (!value) return null;
  return marks[value.trim().toLowerCase()] ?? null;
}
