import type { DeliveryReport } from '@corridra/delivery/report';
import type { MessageKey } from './i18n/messages';

/** One reviewed meeting or visit, exactly as the saved commercial report carries it. */
export type TripMeeting = DeliveryReport['missions'][number]['itinerary'][number];

/** Every Trip word, so a test can prove each one exists in every catalog. */
export const tripKeys = [
  'room.trip.heading',
  'room.trip.line',
  'room.trip.count.one',
  'room.trip.count.other',
  'room.trip.starts',
  'room.trip.ends',
  'room.trip.place',
  'room.trip.noTime',
  'room.trip.noPlace',
  'room.trip.changedBadge',
  'room.trip.changed',
  'room.trip.empty',
  'room.trip.noReport',
  'room.trip.all',
  'room.trip.fewer',
  'room.trip.status.proposed',
  'room.trip.status.accepted',
  'room.trip.status.scheduled',
  'room.trip.status.held',
  'room.trip.status.declined',
  'room.trip.status.cancelled',
  'room.trip.status.noShow',
  'room.trip.status.rescheduleRequired',
] as const satisfies readonly MessageKey[];

/** How many meetings show before "Show all": the scroll budget of a report page (ui-direction.md). */
export const tripFirstShown = 5;

/**
 * A changed schedule, or a status that says a new time is needed, is shown without its old time, place
 * or status. The server already withholds those details; this is the second guard, on the same rule.
 */
export function isChangedMeeting(meeting: Pick<TripMeeting, 'scheduleChanged' | 'status'>) {
  return meeting.scheduleChanged || meeting.status === 'RESCHEDULE_REQUIRED';
}

/** Dated meetings by start time, then undated ones, then changed ones, each group in the server order. */
export function orderTrip(itinerary: readonly TripMeeting[]): TripMeeting[] {
  const dated = itinerary.filter((item) => !isChangedMeeting(item) && item.startsAt);
  const undated = itinerary.filter((item) => !isChangedMeeting(item) && !item.startsAt);
  const changed = itinerary.filter(isChangedMeeting);
  dated.sort((a, b) => Date.parse(a.startsAt ?? '') - Date.parse(b.startsAt ?? ''));
  return [...dated, ...undated, ...changed];
}
