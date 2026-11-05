// Home's journey cards (owner-approved mockup, 5 Nov 2026): the newest piece of work in each journey the person
// has, read from the same work-item list as the Requests page. Pure, so every rule is tested without a database.
// Nothing is invented: a journey with no work has no card, a count is "or more" when a list could not be read
// in full, and a title is the stored text or nothing.
import type { WorkFamily, WorkItem, WorkList } from '../../../lib/work-items/types';
import {
  filterWorkItems,
  incomplete,
  workDateWords,
  workStatusWords,
  type WorkFilter,
} from '../../../lib/work-items/view';

export type Journey = 'source' | 'sell' | 'organise';
export const journeyWords: Record<Journey, string> = {
  source: 'Sourcing',
  sell: 'Selling',
  organise: 'Organising',
};
const familyOf: Record<Journey, WorkFamily> = {
  source: 'SOURCE',
  sell: 'SELL',
  organise: 'ORGANISE',
};

export type JourneyCard = {
  journey: Journey;
  /** How many pieces of work are in this journey, with "or more" when the list is incomplete. */
  count: string;
  title: string | null;
  kind: WorkItem['kind'];
  /** The request's own status for the stage bar; empty for anything that is not a sent request. */
  status: string;
  statusWords: string;
  dateWords: string;
  at: string;
  href: string;
  /** The Requests page filtered to this journey. */
  listHref: string;
};

export type LatestItem = { title: string | null; journey: Journey | null; statusWords: string };

const newestFirst = (a: WorkItem, b: WorkItem) => b.at.localeCompare(a.at);

export function journeysOf(list: WorkList, latestRequestId: string | null) {
  const partial = incomplete(list);
  const cards: JourneyCard[] = [];
  for (const journey of ['source', 'sell', 'organise'] as const) {
    const items = filterWorkItems(list.items, journey as WorkFilter).sort(newestFirst);
    const newest = items[0];
    if (!newest) continue;
    cards.push({
      journey,
      count: partial ? `${items.length} or more` : String(items.length),
      title: newest.title,
      kind: newest.kind,
      status: newest.kind === 'request' ? newest.status : '',
      statusWords: workStatusWords(newest),
      dateWords: workDateWords(newest),
      at: newest.at,
      href: newest.href,
      listHref: `/account?view=work&work=${journey}`,
    });
  }
  const match = latestRequestId
    ? list.items.find((item) => item.kind === 'request' && item.id === latestRequestId)
    : undefined;
  const latest: LatestItem | null = match
    ? {
        title: match.title,
        journey:
          (Object.keys(familyOf) as Journey[]).find((j) => familyOf[j] === match.family) ?? null,
        statusWords: workStatusWords(match),
      }
    : null;
  return { cards, latest };
}
