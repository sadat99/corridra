// Reports in a journey (docs/revamp/specs/journey-modes.md 3.7). A delivered report carries the id of its request;
// the work list says which journey each request is in. This is pure: it names the requests the list places outside
// the chosen journey, so a page can leave their reports out. A request the list does not hold (not read, beyond the
// pages read, withdrawn) is never named: what cannot be sorted stays visible.
import { familyOfJourneyMode, type JourneyOfMode } from '../ux/journey-mode';
import type { WorkList } from './types';

export function requestsOutsideJourney(
  list: Pick<WorkList, 'items'>,
  mode: JourneyOfMode,
): string[] {
  const family = familyOfJourneyMode[mode];
  return list.items
    .filter((item) => item.kind === 'request' && item.family !== family)
    .map((item) => item.id);
}
