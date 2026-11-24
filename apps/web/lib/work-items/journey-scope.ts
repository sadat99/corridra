// One journey at a time (docs/revamp/specs/journey-modes.md 3.7), the pure part. The work list says which journey
// each request is in. A request is left out of a journey only when the list places it in ANOTHER journey. A request
// no journey claims (its brief was not read, it is beyond the detail cap, or its objective names none) and a request
// the list does not hold are never named: what cannot be sorted stays visible, and the page says so.
import { familyOfJourneyMode, type JourneyOfMode } from '../ux/journey-mode';
import type { WorkItem, WorkList } from './types';

/** Requests the list places in a different journey. Their delivered reports are left out. */
export function requestsOutsideJourney(
  list: Pick<WorkList, 'items'>,
  mode: JourneyOfMode,
): string[] {
  const family = familyOfJourneyMode[mode];
  return list.items
    .filter(
      (item) => item.kind === 'request' && item.family !== family && item.family !== 'UNCLASSIFIED',
    )
    .map((item) => item.id);
}

/** Requests the list places in the chosen journey. A report of any other request shown there is not sorted. */
export function requestsInJourney(list: Pick<WorkList, 'items'>, mode: JourneyOfMode): string[] {
  const family = familyOfJourneyMode[mode];
  return list.items
    .filter((item) => item.kind === 'request' && item.family === family)
    .map((item) => item.id);
}

/** What a page shows of reports that carry a request id: which to leave out, and which are known to belong. */
export type JourneyReportScope = { outside: string[]; inJourney: string[] };
export function journeyReportScope(
  list: Pick<WorkList, 'items'>,
  mode: JourneyOfMode,
): JourneyReportScope {
  return {
    outside: requestsOutsideJourney(list, mode),
    inJourney: requestsInJourney(list, mode),
  };
}

/** The reports a journey shows, and whether any of them could not be sorted (so the page says so). */
export function reportsInJourney<T extends { requestId: string }>(
  reports: T[],
  scope: JourneyReportScope | undefined,
): { shown: T[]; unsorted: boolean } {
  if (!scope) return { shown: reports, unsorted: false };
  const shown = reports.filter((report) => !scope.outside.includes(report.requestId));
  return {
    shown,
    unsorted: shown.some((report) => !scope.inJourney.includes(report.requestId)),
  };
}

/** Meetings in a journey: the requests whose meetings are shown. With no journey, every request. */
export function meetingRequests(items: WorkItem[], mode: JourneyOfMode | null): WorkItem[] {
  return items.filter(
    (item) => item.kind === 'request' && (!mode || item.family === familyOfJourneyMode[mode]),
  );
}
