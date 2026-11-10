'use client';

import { useId, useState } from 'react';
import { meetingStatus } from '@corridra/domain/access';
import { StatusBadge } from '../../../../components/access-state';
import { fill } from '../../../../lib/i18n/fill';
import { localeMeta, type Locale } from '../../../../lib/i18n/locales';
import { translate, type MessageKey } from '../../../../lib/i18n/messages';
import {
  hanLang,
  isChangedMeeting,
  orderTrip,
  statusWords,
  tripFirstShown,
  type TripMeeting,
} from '../../../../lib/trip';
import { formatDateTime } from '../../../../lib/ux/format';

/**
 * The meetings and visits of a saved commercial report, read only. It shows what the Corridra team
 * reviewed and nothing else: it is given the itinerary alone, and has no way to book, export or
 * share. It sits inside the report's English region, so its fixed words are the English words and
 * the names and places are written as supplied.
 */
export function TripList({
  itinerary,
  locale,
}: {
  itinerary: readonly TripMeeting[];
  locale: Locale;
}) {
  const say = (key: MessageKey) => translate(locale, key);
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const ordered = orderTrip(itinerary);
  const shown = expanded ? ordered : ordered.slice(0, tripFirstShown);
  const time = (iso: string, item: TripMeeting) => (
    <time dateTime={iso} dir="ltr" lang={localeMeta[locale].html}>
      {formatDateTime(iso, { timeZone: item.timezone ?? 'UTC', locale })}
    </time>
  );

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>{say('room.trip.heading')}</h3>
      <p>{say('room.trip.line')}</p>
      {ordered.length === 0 ? (
        <p className="ux-empty">{say('room.trip.empty')}</p>
      ) : (
        <>
          <p>
            {ordered.length === 1
              ? say('room.trip.count.one')
              : fill(say('room.trip.count.other'), { count: ordered.length })}
          </p>
          <ol className="room-trip-list" aria-labelledby={headingId}>
            {shown.map((item, index) => {
              const changed = isChangedMeeting(item);
              const place = item.location ?? say('room.trip.noPlace');
              const known = meetingStatus.safeParse(item.status);
              return (
                <li key={index} className="room-strip">
                  <div className="room-trip-head">
                    <h4 dir="auto" lang={hanLang(item.label)}>
                      {item.label}
                    </h4>
                    {changed ? (
                      <StatusBadge tone="caution">{say('room.trip.changedBadge')}</StatusBadge>
                    ) : known.success ? (
                      <StatusBadge tone={statusWords[known.data].tone}>
                        {say(statusWords[known.data].key)}
                      </StatusBadge>
                    ) : (
                      <StatusBadge>{item.status}</StatusBadge>
                    )}
                  </div>
                  {changed ? (
                    <p>{say('room.trip.changed')}</p>
                  ) : (
                    <>
                      {!item.startsAt && <p>{say('room.trip.noTime')}</p>}
                      <dl className="room-trip-facts">
                        {item.startsAt && (
                          <div>
                            <dt>{say('room.trip.starts')}</dt>
                            <dd>{time(item.startsAt, item)}</dd>
                          </div>
                        )}
                        {item.startsAt && item.endsAt && (
                          <div>
                            <dt>{say('room.trip.ends')}</dt>
                            <dd>{time(item.endsAt, item)}</dd>
                          </div>
                        )}
                        <div>
                          <dt>{say('room.trip.place')}</dt>
                          <dd dir="auto" lang={hanLang(place)}>
                            {place}
                          </dd>
                        </div>
                      </dl>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {ordered.length > tripFirstShown && (
            <button
              type="button"
              className="text-link"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? say('room.trip.fewer')
                : fill(say('room.trip.all'), { count: ordered.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}
