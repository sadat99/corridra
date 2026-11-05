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
  /** The newest item's source record id and workspace, so its numbers can be read for this card only. */
  id: string;
  workspaceId: string;
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
      id: newest.id,
      workspaceId: newest.workspaceId,
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

export const journeys = ['source', 'sell', 'organise'] as const;
export function isJourney(value: unknown): value is Journey {
  return typeof value === 'string' && (journeys as readonly string[]).includes(value);
}
const journeyOfFamily = (family: WorkFamily): Journey | null =>
  (Object.keys(familyOf) as Journey[]).find((j) => familyOf[j] === family) ?? null;

/**
 * The journey a task on Home belongs to, read from the work list: a draft or request by its own record,
 * a Move, report or reply by its request. Anything the list does not classify has no journey and shows under All only.
 */
export function journeyOfTask(
  list: Pick<WorkList, 'items'>,
  task: { kind: string; id: string; requestId?: string },
): Journey | null {
  // A draft card and a request row carry the work list's own key; a Move, report or reply carries its request.
  const key =
    task.kind === 'draft' || task.kind === 'request'
      ? task.id
      : task.requestId
        ? `request:${task.requestId}`
        : null;
  if (!key) return null;
  const item = list.items.find((entry) => entry.key === key);
  return item ? journeyOfFamily(item.family) : null;
}

/** Which records the journey cards' numbers come from: only a sent request or a programme has any. */
export function journeyTargets(cards: JourneyCard[]) {
  const card = (journey: Journey) => cards.find((c) => c.journey === journey);
  const request = (journey: Journey) => {
    const c = card(journey);
    return c && c.kind === 'request' ? c.id : null;
  };
  const organise = card('organise');
  return {
    source: request('source'),
    sell: request('sell'),
    organise:
      organise && organise.kind === 'programme'
        ? { workspaceId: organise.workspaceId, programmeId: organise.id }
        : null,
  };
}
