// Turns a meeting row into the plain strings the Meetings page draws, on the server, so the client part holds no
// date rule and no old detail of a changed schedule. The fixed words are the Trip words the Room already uses, in
// English: the page has no reviewed translation yet.
import { meetingStatus } from '@corridra/domain/access';
import { translate } from '../i18n/messages';
import { hanLang, statusWords } from '../trip';
import { formatDateTime } from '../ux/format';
import type { MeetingRow } from './load';

export type Tone = 'neutral' | 'positive' | 'caution' | 'info';
export type Timed = { iso: string; text: string };

export type MeetingCard = {
  key: string;
  name: string;
  nameLang: 'zh' | undefined;
  badge: { text: string; tone: Tone | undefined };
  requestTitle: string;
  requestLang: 'zh' | undefined;
  href: string;
  /** Null for a changed schedule: it carries no time, place or status at all. */
  details: {
    starts: Timed | null;
    ends: Timed | null;
    place: string;
    placeLang: 'zh' | undefined;
  } | null;
};

/** The switches that decide where a meeting opens. Read on the server by the page. */
export type MeetingLinkSwitches = { trip: boolean; road: boolean; lenses: boolean };

const say = (key: Parameters<typeof translate>[1]) => translate('en', key);
export const requestTitleFallback = 'Your request';

/**
 * With Trip and the Room on, a meeting opens in its Room (on Meetings when the lenses are on). In every other
 * case it opens the saved report, where its times are, as the Room itself does.
 */
export function meetingHref(
  row: Pick<MeetingRow, 'requestId' | 'savedResourceId'>,
  switches: MeetingLinkSwitches,
): string {
  if (switches.trip && switches.road)
    return `/account/rooms/${encodeURIComponent(row.requestId)}${switches.lenses ? '?view=meetings' : ''}`;
  return `/account/missions/${encodeURIComponent(row.savedResourceId)}`;
}

export function meetingCard(
  row: MeetingRow,
  index: number,
  switches: MeetingLinkSwitches,
): MeetingCard {
  const requestTitle = row.requestTitle ?? requestTitleFallback;
  const base = {
    key: `${row.savedResourceId}:${index}`,
    name: row.label,
    nameLang: hanLang(row.label),
    requestTitle,
    requestLang: hanLang(requestTitle),
    href: meetingHref(row, switches),
  };
  if (row.changed)
    return {
      ...base,
      badge: { text: say('room.trip.changedBadge'), tone: 'caution' },
      details: null,
    };
  const known = meetingStatus.safeParse(row.status);
  const when = (iso: string): Timed => ({
    iso,
    text: formatDateTime(iso, { timeZone: row.timezone ?? 'UTC', locale: 'en' }),
  });
  const place = row.location ?? say('room.trip.noPlace');
  return {
    ...base,
    badge: known.success
      ? { text: say(statusWords[known.data].key), tone: statusWords[known.data].tone }
      : { text: row.status ?? '', tone: undefined },
    details: {
      starts: row.startsAt ? when(row.startsAt) : null,
      ends: row.startsAt && row.endsAt ? when(row.endsAt) : null,
      place,
      placeLang: hanLang(place),
    },
  };
}
