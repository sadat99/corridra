// The count beside each Your Journeys link in the signed-in sidebar. It is the Requests page's own "Your work"
// number for that journey (filterWorkItems over the same list, so the same workspace and role scoping and the same
// "or more" rule): nothing is counted that the person could not open from the Requests list. Pure, so every rule is
// tested without a database. A zero is not drawn; a list that could not be read in full says "N+".
import { filterWorkItems, incomplete, type WorkFilter } from './view';
import type { WorkList } from './types';

export type JourneyCount = { n: number; partial: boolean };
export type JourneyCounts = Record<'source' | 'organise' | 'sell', JourneyCount>;

export function journeyCountsOf(list: WorkList): JourneyCounts {
  const partial = incomplete(list);
  const of = (filter: WorkFilter): JourneyCount => ({
    n: filterWorkItems(list.items, filter).length,
    partial,
  });
  return { source: of('source'), organise: of('organise'), sell: of('sell') };
}

/** What the badge says: nothing for zero (a quiet sidebar), the number, or "N+" when the list may be longer. */
export function journeyCountText(count: JourneyCount | undefined): string {
  if (!count || count.n <= 0) return '';
  return count.partial ? `${count.n}+` : String(count.n);
}

/** The badge's words for assistive technology. */
export function journeyCountWords(count: JourneyCount | undefined): string {
  if (!count || count.n <= 0) return '';
  const unit = count.n === 1 ? 'piece of work' : 'pieces of work';
  return `${count.n}${count.partial ? ' or more' : ''} ${unit}`;
}
