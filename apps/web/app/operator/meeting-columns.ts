import { meetingTransitions, type MeetingStatus } from '@corridra/domain/access';

/**
 * Team desk v4.1, unit D11: the five columns of the Meetings board. A column is a set of the eight stored
 * meeting statuses (packages/domain/src/access.ts), taken from the transition table: the three statuses a meeting
 * moves through in order each have a column, the two whose only way forward is a new time share one, and the
 * three with no next state share the last. A column title is a heading over a group; every card still shows its
 * own exact status word, so "Finished" never stands in for Held, Declined or Cancelled. An introduction is not a
 * meeting and is never placed in a column (V3-02-016). Nothing here changes a status, a transition or a payload.
 */
export const meetingColumns: readonly {
  id: string;
  title: string;
  statuses: readonly MeetingStatus[];
}[] = [
  { id: 'proposed', title: 'Proposed', statuses: ['PROPOSED'] },
  { id: 'accepted', title: 'Accepted', statuses: ['ACCEPTED'] },
  { id: 'scheduled', title: 'Scheduled', statuses: ['SCHEDULED'] },
  { id: 'new-time', title: 'Needs a new time', statuses: ['NO_SHOW', 'RESCHEDULE_REQUIRED'] },
  { id: 'finished', title: 'Finished', statuses: ['HELD', 'DECLINED', 'CANCELLED'] },
];

/** The column a status belongs to. Every stored status has exactly one (checked by a unit test). */
export function meetingColumnOf(status: MeetingStatus): string {
  return meetingColumns.find((column) => column.statuses.includes(status))!.id;
}

/** The statuses with no next state: what the last column holds. */
export const finishedMeetingStatuses = (Object.keys(meetingTransitions) as MeetingStatus[]).filter(
  (status) => meetingTransitions[status].length === 0,
);

/**
 * The tone of a status word. Colour is never the only sign: the word is always written. Held is the only
 * positive one; Declined and Cancelled are neutral, never shown as a success.
 */
export function meetingStatusTone(
  status: MeetingStatus,
): 'positive' | 'caution' | 'unknown' | 'info' {
  if (status === 'HELD') return 'positive';
  if (status === 'NO_SHOW' || status === 'RESCHEDULE_REQUIRED') return 'caution';
  if (status === 'DECLINED' || status === 'CANCELLED') return 'unknown';
  return 'info';
}
