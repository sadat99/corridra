// Journey modes (docs/revamp/specs/journey-modes.md, owner approved 23 Nov 2026). While a person works in one
// journey the sidebar and the pages show only that journey. This file is the whole model and it is pure: one cookie
// with a closed list of values, one resolution order, where a switch lands and what the sidebar lists per mode. It
// decides nothing about access: a mode only narrows a list the person was already allowed to read, and any value
// outside the closed list is Everything.

export const journeyModes = ['all', 'source', 'organise', 'sell'] as const;
export type JourneyMode = (typeof journeyModes)[number];
export type JourneyOfMode = Exclude<JourneyMode, 'all'>;
/** The same shape as the work-item family (lib/work-items/types.ts), kept here so this file imports nothing. */
type Family = 'SELL' | 'SOURCE' | 'ORGANISE' | 'UNCLASSIFIED';

/** The control is called Journey; these are its four choices, in English. */
export const journeyModeWords: Record<JourneyMode, string> = {
  all: 'Everything',
  source: 'Sourcing',
  organise: 'Organising',
  sell: 'Selling',
};

/** The dot beside a journey, the sidebar's existing tones. Everything has none. */
export const journeyModeTone: Record<JourneyOfMode, 'action' | 'positive' | 'ornament'> = {
  source: 'action',
  organise: 'positive',
  sell: 'ornament',
};

/** One cookie, a display preference only: no identity, no tracking. There is no second cookie. */
export const journeyModeCookie = 'corridra_journey';

/** Reads a mode through the closed list. Anything else, including a repeated value, is Everything. */
export function parseJourneyMode(value: unknown): JourneyMode {
  return typeof value === 'string' ? (journeyModes.find((mode) => mode === value) ?? 'all') : 'all';
}

/** What the browser writes: a year, this site only, the account pages only. Never HttpOnly (the page writes it). */
export function journeyCookieString(mode: JourneyMode, secure: boolean): string {
  return `${journeyModeCookie}=${parseJourneyMode(mode)}; Path=/account; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** The page's own word first (Home's `?journey=`, Requests' `?work=`), then the cookie, then Everything. */
export function resolveJourneyMode({
  explicit,
  cookie,
}: {
  explicit?: JourneyMode | null;
  cookie?: unknown;
}): JourneyMode {
  return explicit ?? parseJourneyMode(cookie);
}

const isJourneyOfMode = (value: unknown): value is JourneyOfMode =>
  value === 'source' || value === 'organise' || value === 'sell';

/** Home's `?journey=`: a known journey is that mode; anything else is no opinion, so the cookie decides. */
export function journeyModeOfJourney(value: unknown): JourneyOfMode | null {
  return isJourneyOfMode(value) ? value : null;
}

/**
 * The Requests filter as a mode: a journey is that journey; Other, All and any unknown or repeated word are
 * Everything (what the page already shows for them); an address with no `work` has no opinion.
 */
export function journeyModeOfWork(work: string | string[] | undefined): JourneyMode | null {
  if (work === undefined) return null;
  return isJourneyOfMode(work) ? work : 'all';
}

/** The Requests filter a mode stands for when the address names none. */
export function workFilterOfMode(mode: JourneyMode): JourneyMode {
  return mode;
}

/** Home and Requests opened in a mode. Everything is exactly today's address. */
export function journeyScopedHref(tab: 'home' | 'requests', mode: JourneyMode): string {
  if (tab === 'home') return mode === 'all' ? '/account/move' : `/account/move?journey=${mode}`;
  return mode === 'all' ? '/account?view=work' : `/account?view=work&work=${mode}`;
}

/**
 * Where choosing a mode goes: the same section of the new journey. Home and Requests carry the journey in their
 * address, so the address changes (every other word and a fragment are kept). Every other page stays where it is and
 * reads the cookie again: null.
 */
export function hrefForJourneySwitch(
  pathname: string,
  search: string,
  mode: JourneyMode,
): string | null {
  const cut = search.indexOf('#');
  const hash = cut < 0 ? '' : search.slice(cut);
  const params = new URLSearchParams(cut < 0 ? search : search.slice(0, cut));
  const key =
    pathname === '/account/move'
      ? 'journey'
      : pathname === '/account' && params.get('view') === 'work'
        ? 'work'
        : null;
  if (!key) return null;
  if (mode === 'all') params.delete(key);
  else params.set(key, mode);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${hash}`;
}

const modeOfFamily: Record<Family, JourneyOfMode | null> = {
  SOURCE: 'source',
  ORGANISE: 'organise',
  SELL: 'sell',
  UNCLASSIFIED: null,
};
/** The family a journey's work carries. */
export const familyOfJourneyMode: Record<JourneyOfMode, Exclude<Family, 'UNCLASSIFIED'>> = {
  source: 'SOURCE',
  organise: 'ORGANISE',
  sell: 'SELL',
};

/**
 * The journey a request page offers to switch to: only while a journey is chosen and the page's request is in a
 * different one. Everything, a matching journey, an unsorted request and the switch being off (null) offer nothing.
 */
export function shouldOfferSwitch(mode: JourneyMode | null, family: Family): JourneyOfMode | null {
  const journey = modeOfFamily[family];
  return mode && mode !== 'all' && journey && journey !== mode ? journey : null;
}

/**
 * Whether the sidebar draws Groups (Programmes, Registrations): in Everything and Organising, and on a Groups page
 * in any mode, so a link from an email never opens a sidebar that leaves out where the person is.
 */
export function groupsShownInJourney(mode: JourneyMode, onGroupsPage: boolean): boolean {
  return mode === 'all' || mode === 'organise' || onGroupsPage;
}

type Count = { n: number; partial: boolean };
/**
 * The quiet count on the closed switcher: work in the journeys that are not the current one. Nothing in Everything
 * or before the counts are read. "Or more" when any list was not read in full.
 */
export function elsewhereCount(
  counts: Record<JourneyOfMode, Count> | null | undefined,
  mode: JourneyMode,
): Count | undefined {
  if (!counts || mode === 'all') return undefined;
  const others = (['source', 'organise', 'sell'] as const).filter((journey) => journey !== mode);
  return {
    n: others.reduce((sum, journey) => sum + counts[journey].n, 0),
    partial: others.some((journey) => counts[journey].partial),
  };
}
