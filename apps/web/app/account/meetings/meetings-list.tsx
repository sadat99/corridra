'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { StatusBadge } from '../../../components/access-state';
import { fill } from '../../../lib/i18n/fill';
import { translate } from '../../../lib/i18n/messages';
import type { MeetingCard } from '../../../lib/meetings/cards';
import { hanLang, meetingsFirstShown } from '../../../lib/trip';

type MeetingGroupKey = 'upcoming' | 'past' | 'undated' | 'changed';
export type MeetingGroup = { key: MeetingGroupKey; cards: MeetingCard[] };
type RequestLink = { key: string; title: string; href: string };

/** More requests than this show behind "Show All". */
const requestsFirstShown = 5;

const say = (key: Parameters<typeof translate>[1]) => translate('en', key);
const groupHeading: Record<MeetingGroupKey, string> = {
  upcoming: 'Coming up',
  past: 'Done and past',
  undated: 'Time not confirmed yet',
  changed: 'Date changed',
};

function Time({ value }: { value: { iso: string; text: string } }) {
  return (
    <time dateTime={value.iso} dir="ltr" lang="en">
      {value.text}
    </time>
  );
}

/**
 * Every meeting and visit across the person's requests, read only. It is given plain strings already formatted
 * on the server, with the old details of a changed schedule already removed, so it has nothing to hide, book,
 * export or share. The first few show, then "Show All".
 */
export function MeetingsList({ groups }: { groups: readonly MeetingGroup[] }) {
  const listId = useId();
  const headingIds = useId();
  const [expanded, setExpanded] = useState(false);
  const total = groups.reduce((sum, group) => sum + group.cards.length, 0);
  const limit = expanded ? total : meetingsFirstShown;
  // Where each group starts in the whole list, so the cap and the "item n of N" read across groups.
  const starts = groups.map((_, index) =>
    groups.slice(0, index).reduce((sum, group) => sum + group.cards.length, 0),
  );
  return (
    <>
      <p>
        {total > limit
          ? `Showing ${limit} of ${total} meetings and visits.`
          : total === 1
            ? say('room.trip.count.one')
            : fill(say('room.trip.count.other'), { count: total })}
      </p>
      <div id={listId} className="room">
        {groups.map((group, groupIndex) => {
          const start = starts[groupIndex] ?? 0;
          const cards = group.cards.slice(0, Math.max(0, limit - start));
          if (cards.length === 0) return null;
          const headingId = `${headingIds}-${group.key}`;
          return (
            <section key={group.key} aria-labelledby={headingId}>
              <h2 id={headingId}>{groupHeading[group.key]}</h2>
              <ol className="room-trip-list">
                {cards.map((card, index) => (
                  <li key={card.key} className="room-strip">
                    <div className="room-trip-head">
                      <h3 dir="auto" lang={card.nameLang}>
                        {card.name}
                      </h3>
                      <StatusBadge tone={card.badge.tone}>{card.badge.text}</StatusBadge>
                    </div>
                    {card.details ? null : <p>{say('room.trip.changed')}</p>}
                    <dl className="room-trip-facts">
                      {card.details?.starts && (
                        <div>
                          <dt>{say('room.trip.starts')}</dt>
                          <dd>
                            <Time value={card.details.starts} />
                          </dd>
                        </div>
                      )}
                      {card.details?.ends && (
                        <div>
                          <dt>{say('room.trip.ends')}</dt>
                          <dd>
                            <Time value={card.details.ends} />
                          </dd>
                        </div>
                      )}
                      {card.details && (
                        <div>
                          <dt>{say('room.trip.place')}</dt>
                          <dd dir="auto" lang={card.details.placeLang}>
                            {card.details.place}
                          </dd>
                        </div>
                      )}
                      <div>
                        <dt>Request</dt>
                        <dd dir="auto" lang={card.requestLang}>
                          {card.requestTitle}
                        </dd>
                      </div>
                    </dl>
                    <div className="room-actions">
                      <Link className="text-link" prefetch={false} href={card.href}>
                        Open in the Request
                        <span className="sr-only">
                          : {card.name}, {card.requestTitle}, item {start + index + 1} of {total}
                        </span>
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      {total > meetingsFirstShown && (
        <button
          type="button"
          className="text-link"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? say('room.trip.fewer') : fill(say('room.trip.all'), { count: total })}
        </button>
      )}
    </>
  );
}

/** The person's requests, each opening where its meetings and visits are. Over five, the rest are behind "Show All". */
export function RequestsSection({
  requests,
  withMeetings,
}: {
  requests: readonly RequestLink[];
  /** Meetings are shown above. Only then does the line say where they come from. */
  withMeetings: boolean;
}) {
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? requests : requests.slice(0, requestsFirstShown);
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Your requests</h2>
      <p>
        {withMeetings
          ? 'Meetings above come from the reports you have saved. Open any request to see all of it, including requests with no meetings yet.'
          : 'Open any request to see all of it.'}
      </p>
      <ul className="ux-meeting-list" id={listId}>
        {shown.map((request) => (
          <li key={request.key}>
            <Link
              prefetch={false}
              className="text-link"
              href={request.href}
              dir="auto"
              lang={hanLang(request.title)}
            >
              {request.title}
              <span className="sr-only">: meetings and visits</span>
            </Link>
          </li>
        ))}
      </ul>
      {requests.length > requestsFirstShown && (
        <button
          type="button"
          className="text-link"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show Fewer' : `Show All ${requests.length} Requests`}
        </button>
      )}
    </section>
  );
}
