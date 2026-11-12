// The team command palette's pure parts (Navigation v1): the actions a role may open, the scopes, and
// the keyboard rules. Nothing here reads data or grants access: actions come from the same map the sidebar
// uses and are listed only for a role that may open the place; the server still decides every page. Owner: S4.
import {
  placeHref,
  settingsLevel,
  teamAccountPlaces,
  teamItemsFor,
  teamPlacesFor,
  type TeamPlace,
} from './team-map';

export const paletteScopeList = [
  { id: 'all', label: 'All' },
  { id: 'missions', label: 'Missions' },
  { id: 'companies', label: 'Companies' },
  { id: 'actions', label: 'Actions' },
] as const;
export type PaletteScopeId = (typeof paletteScopeList)[number]['id'];

/** What a row shows beside its words: a stage badge or source chip, a close-match note, a kind word. All optional. */
export type RowFacts = {
  badge?: { text: string; tone: 'neutral' | 'caution' | 'critical' };
  chip?: { text: string; tone: 'neutral' | 'caution'; icon: 'document' | 'clock' };
  close?: boolean;
  kind?: 'Mission' | 'Company';
};

export type PaletteEntry = {
  key: string;
  group: 'Missions' | 'Companies' | 'Actions' | 'Recent' | 'Search';
  label: string;
  detail: string;
  href: string;
  /** Words after the detail that are not searched or marked, such as the staff stage and "Opens Missions". */
  suffix?: string;
  /** The typed words to mark in the label and detail; `close` when the hit was found through a near miss. */
  match?: { query: string; close: boolean };
  facts?: RowFacts;
  /** A mission or company opened from the palette is remembered on this device; an action never is. */
  remember?: { kind: 'mission' | 'company'; id: string; label: string };
  /** A row that runs something instead of opening an address. */
  command?: 'retry' | 'clear-recents';
};

/** Every place the role may open, as an "Open ..." action. Each place appears once. */
export function paletteActions(
  role: string | null,
  urls: boolean,
  tenant: string,
  ownerPage: boolean,
): PaletteEntry[] {
  const seen = new Set<string>();
  const entries: PaletteEntry[] = [];
  const add = (place: TeamPlace, detail: string) => {
    if (place.id === 'owner' && !ownerPage) return;
    if (seen.has(place.id)) return;
    seen.add(place.id);
    entries.push({
      key: 'action:' + place.id,
      group: 'Actions',
      label: 'Open ' + place.label,
      detail,
      href: placeHref(place.id, urls, tenant),
    });
  };
  for (const item of teamItemsFor(role))
    for (const place of teamPlacesFor(item, role)) add(place, item.label);
  for (const place of settingsLevel(role)) add(place, 'Settings');
  for (const place of teamAccountPlaces(role)) add(place, 'Account');
  return entries;
}

/** Actions whose words all appear in the query, in order of the map. */
export function filterActions(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const haystack = (entry.label + ' ' + entry.detail).toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** Up and Down move through the list and stop at the ends (no wrap); an empty list has no selection. */
export function moveSelection(
  current: number,
  key: 'ArrowUp' | 'ArrowDown',
  count: number,
): number {
  if (count === 0) return -1;
  if (key === 'ArrowDown') return Math.min(current + 1, count - 1);
  return Math.max(current - 1, 0);
}

/** Tab moves to the next scope and Shift+Tab to the previous, wrapping. */
export function nextScope(current: PaletteScopeId, backwards: boolean): PaletteScopeId {
  const ids = paletteScopeList.map((scope) => scope.id);
  const at = ids.indexOf(current);
  return ids[(at + (backwards ? ids.length - 1 : 1)) % ids.length]!;
}

/** Ctrl K on most systems, Command K on a Mac. */
export function isPaletteShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    event.key.toLowerCase() === 'k' &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}
