'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { displayDate } from '@corridra/domain/locale';
import { FactLabel, factLabels } from '../../../../components/fact-label';
import { useLanguage } from '../../../../components/language-provider';
import { ModeLabel, Road, mrLabelsFor } from '../../../../components/mr';
import { fill } from '../../../../lib/i18n/fill';
import { localeMeta } from '../../../../lib/i18n/locales';
import { translate, type MessageKey } from '../../../../lib/i18n/messages';
import { emblemFor, roadRecords, type RoomLink } from '../../../../lib/room';
import { SavedCommercialReport } from '../../missions/saved-commercial-report';
import { useRoomDetail } from './room-data';
import './room-view.css';

type Lens = 'overview' | 'compare' | 'evidence';
const lensKey: Record<Lens, MessageKey> = {
  overview: 'room.lens.overview',
  compare: 'room.lens.compare',
  evidence: 'room.lens.evidence',
};

/**
 * One request in one place: who and what it is, where it stands (the Road), what the Corridra team
 * has said, and the lenses onto the delivered report. It composes pages that already exist and adds
 * no data: every action of the saved request page and the saved mission page stays one tap away.
 */
export function RoomView({
  requestId,
  subject,
  issuer,
  link,
  serviceRequestsEnabled = false,
  decisionsEnabled = false,
  lenses = false,
}: {
  requestId: string;
  subject: string;
  issuer: string;
  link: RoomLink;
  serviceRequestsEnabled?: boolean;
  decisionsEnabled?: boolean;
  lenses?: boolean;
}) {
  const { locale } = useLanguage();
  const say = (key: MessageKey) => translate(locale, key);
  const labels = useMemo(() => mrLabelsFor(locale), [locale]);
  const { html, dir } = localeMeta[locale];
  const { detail, state, retry } = useRoomDetail(requestId, subject, issuer);
  const [lens, setLens] = useState<Lens>('overview');
  const [showAll, setShowAll] = useState(false);

  const original = detail?.original ?? null;
  const title = original?.objective?.trim() || '…';
  const emblem = emblemFor(title);
  const replies = detail?.progress
    ? [...detail.progress.replies].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const shown = showAll ? replies : replies.slice(0, 1);
  const hasReport = link.reportAvailable;
  const reportHref = link.savedResourceId ? `/account/missions/${link.savedResourceId}` : null;

  return (
    <div className="room" lang={html} dir={dir}>
      {state === 'loading' && <p role="status">{say('room.loading')}</p>}
      {state === 'denied' && (
        <div role="alert">
          <p>{say('room.denied')}</p>
          <a className="text-link" href="/signin">
            Sign in
          </a>
        </div>
      )}
      {state === 'unavailable' && <p role="status">{say('room.failed')}</p>}
      {state === 'failed' && (
        <p role="alert">
          {say('room.failed')}{' '}
          <button type="button" className="text-link" onClick={retry}>
            Retry
          </button>
        </p>
      )}
      {state === 'ready' && detail && !detail.available && <p role="status">{say('room.gone')}</p>}
      {state === 'ready' && detail?.available && detail.progress && (
        <>
          <header className="room-head">
            <span className="room-emblem" data-tone={emblem.tone} aria-hidden="true">
              {emblem.initials}
            </span>
            <div>
              <h2>{title}</h2>
              <p>
                {original?.market ? `${original.market} · ` : ''}
                {fill(say('room.received'), {
                  date: displayDate(detail.progress.receivedAt, 'UTC', locale),
                })}
              </p>
              <ModeLabel real={realCustomerInput()} labels={labels.mode} />
            </div>
          </header>

          <Road status={detail.progress.status} records={roadRecords(link)} labels={labels.road} />

          <section className="room-strip" aria-label={say('room.replies.heading')}>
            <h3>{say('room.replies.heading')}</h3>
            {replies.length === 0 ? (
              <p>{say('room.replies.none')}</p>
            ) : (
              shown.map((reply) => (
                <div key={reply.createdAt + reply.body.slice(0, 12)}>
                  <p lang="en" dir="ltr">
                    {reply.body}
                  </p>
                  <time dateTime={reply.createdAt}>
                    {displayDate(reply.createdAt, 'UTC', locale)}
                  </time>
                </div>
              ))
            )}
            {replies.length > 1 && (
              <button type="button" className="text-link" onClick={() => setShowAll((v) => !v)}>
                {showAll ? '−' : '+'} {say('room.replies.all')}
              </button>
            )}
          </section>

          {lenses && (
            <div className="room-lenses" role="group" aria-label={say('room.lens.overview')}>
              {(['overview', 'compare', 'evidence'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className="room-lens"
                  aria-pressed={lens === item}
                  onClick={() => setLens(item)}
                >
                  {say(lensKey[item])}
                </button>
              ))}
            </div>
          )}

          {lenses && lens === 'evidence' && (
            <section aria-labelledby="room-legend">
              <h3 id="room-legend">{say('room.evidence.heading')}</h3>
              <p>{say('room.evidence.line')}</p>
              <ul className="room-legend">
                {factLabels.map((fact) => (
                  <li key={fact.label}>
                    <FactLabel label={fact.label} />
                    <span lang="en">{fact.line}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lenses && lens !== 'overview' && (
            <div lang="en" dir="ltr">
              {link.savedResourceId ? (
                <SavedCommercialReport
                  resourceId={link.savedResourceId}
                  subject={subject}
                  issuer={issuer}
                  decisionsEnabled={decisionsEnabled}
                  lenses
                  section={lens}
                />
              ) : (
                <p className="ux-empty" role="status">
                  {say('room.lens.none')}
                </p>
              )}
            </div>
          )}

          <div className="room-actions">
            <Link prefetch={false} className="text-link" href={`/account/requests/${requestId}`}>
              {say('room.open.request')}
            </Link>
            {serviceRequestsEnabled && (
              <Link
                prefetch={false}
                className="text-link"
                href={`/account/service-requests/new?kind=request&ref=${encodeURIComponent(requestId)}`}
              >
                {say('room.open.help')}
              </Link>
            )}
            {reportHref ? (
              <Link prefetch={false} className="text-link" href={reportHref}>
                {say('room.open.report')}
              </Link>
            ) : hasReport ? (
              <Link prefetch={false} className="text-link" href="/account?view=results">
                {say('room.open.library')}
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
