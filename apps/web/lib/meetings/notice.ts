// Decides when the Meetings page must say its lists may be incomplete (docs/revamp/specs/workflow-intelligence.md,
// W8). Only what makes the requests or the meetings incomplete counts. A failed drafts, programmes or services list,
// and the detail cap (requests past it are still listed, only their title and family are unknown), do not.
import type { WorkList } from '../work-items/types';
import type { MeetingsRead } from './load';

type RequestsRead = Pick<WorkList, 'unreadable' | 'requestsIncomplete'>;

/**
 * The requests list may be missing requests: it could not be read, the account or workspaces behind it could not be
 * read (so no request could be listed), or its pages were not followed to the end. While this is true the page must
 * not say the person has no requests.
 */
export function requestsMayBeMissing(list: RequestsRead): boolean {
  return (
    list.requestsIncomplete === true ||
    list.unreadable.some(
      (source) => source === 'requests' || source === 'account' || source === 'workspaces',
    )
  );
}

/** The partial notice: the requests list or the meetings may be incomplete. */
export function meetingsPartial(
  list: RequestsRead,
  meetings: Pick<MeetingsRead, 'partial'>,
): boolean {
  return requestsMayBeMissing(list) || meetings.partial;
}
