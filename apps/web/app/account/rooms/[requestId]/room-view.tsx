'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { DeliveryReport } from '@corridra/delivery/report';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { formatDateTime } from '../../../../lib/ux/format';
import { placeName, requestTitle } from '../../request-words';
import { FactLabel, factLabels } from '../../../../components/fact-label';
import { CorridraIcon } from '../../../../components/corridra-icon';
import { useLanguage } from '../../../../components/language-provider';
import { ModeLabel, StageBar, mrLabelsFor } from '../../../../components/mr';
import { SourceLedger } from '../../../../components/source-ledger';
import { SellBoard } from '../../../../components/sell-board';
import { sellFacts } from '../../../../lib/home-journeys/facts';
import { fill } from '../../../../lib/i18n/fill';
import { localeMeta } from '../../../../lib/i18n/locales';
import { translate, type MessageKey } from '../../../../lib/i18n/messages';
import { afterSaveHref, roadRecords, type RoomLink, type RoomTask } from '../../../../lib/room';
import { MissingTermNotice } from '../../../../components/missing-term-notice';
import { classifyObjective } from '../../../../lib/work-items/classify';
import { isCurrentOffer } from '../../../../lib/experience-offers';
import { SavedCommercialReport, type ReportSection } from '../../missions/saved-commercial-report';
import { useRoomDetail } from './room-data';
import { RoomSave } from './room-save';
import { TripList } from './trip-list';
import './room-view.css';
import './room-frame.css';

type Lens = 'overview' | 'compare' | 'evidence' | 'trip';
const lensKey: Record<Lens, MessageKey> = {
  overview: 'room.lens.overview',
  compare: 'room.lens.compare',
  evidence: 'room.lens.evidence',
  trip: 'room.lens.trip',
};
// The approved Source room names its views for the sourcing job (owner, 5 Nov 2026). Launch language is
// English only, so these words carry lang="en" in every locale.
const sourceLensWords: Record<Lens, string> = {
  overview: 'Overview',
  compare: 'Compare Quotes',
  evidence: 'Evidence',
  trip: 'Visit',
};
// The approved Sell room: the buyers, then the meetings (owner, 5 Nov 2026).
const sellLensWords: Record<Lens, string> = {
  overview: 'Overview',
  compare: 'Buyers',
  evidence: 'Evidence',
  trip: 'Meetings',
};
const journeyWords = { SOURCE: 'Sourcing', SELL: 'Selling', ORGANISE: 'Organising' } as const;
const journeyKey = { SOURCE: 'source', SELL: 'sell', ORGANISE: 'organise' } as const;

/**
 * One request in one place (the approved work rooms, 5 Nov 2026): who and what it is, where it stands, the
 * one next step, the views of the delivered report, and what the Corridra team has said. It composes pages
 * that already exist and adds no data: every action of the saved request page and the saved mission page
 * stays one tap away.
 */
export function RoomView({
  requestId,
  subject,
  issuer,
  link,
  serviceRequestsEnabled = false,
  decisionsEnabled = false,
  specificationConfirmationsEnabled = false,
  lenses = false,
  trip = false,
  initialLens,
  task,
  hintClosed = false,
  unreadable = false,
  reportCount = 0,
}: {
  requestId: string;
  subject: string;
  issuer: string;
  link: RoomLink;
  serviceRequestsEnabled?: boolean;
  decisionsEnabled?: boolean;
  specificationConfirmationsEnabled?: boolean;
  lenses?: boolean;
  /** Batch E (`CORRIDRA_UX_TRIP`, read on the server): a fourth lens with the reviewed meetings and visits. */
  trip?: boolean;
  /**
   * Where the Room opens when the address asks for Meetings (`?view=meetings`) or the comparison
   * (`?view=compare`). The Overview when absent. The comparison opens only once the saved report shows something
   * to compare; until then, and when it has nothing, the Overview stays.
   */
  initialLens?: Lens;
  /** What the delivered reports ask of the person, resolved on the server from their own list. */
  task?: RoomTask;
  /** The address named a report that is not open to this person for this request. */
  hintClosed?: boolean;
  /** The list of delivered reports could not be read: nothing is claimed, offered or saved. */
  unreadable?: boolean;
  /** How many reports are open for this request. */
  reportCount?: number;
}) {
  const router = useRouter();
  const { locale } = useLanguage();
  const say = (key: MessageKey) => translate(locale, key);
  const labels = useMemo(() => mrLabelsFor(locale), [locale]);
  const { html, dir } = localeMeta[locale];
  const { detail, state, retry } = useRoomDetail(requestId, subject, issuer);
  // One read of the saved report serves every view: the report component tells the Room what it read.
  const [report, setReport] = useState<{ data: DeliveryReport | null; status: string }>({
    data: null,
    status: 'loading',
  });
  // The report saved in this visit, from its confirmed receipt, before the server's next answer names it too.
  const [saved, setSaved] = useState<{ assignmentId: string; resourceId: string } | null>(null);
  // Asked to open the comparison: decided once the saved report is read, never promised before.
  const arriving = useRef(initialLens === 'compare');
  const [waiting, setWaiting] = useState(initialLens === 'compare');
  const [nothingToCompare, setNothingToCompare] = useState(false);
  const [lens, setLens] = useState<Lens>(
    initialLens === 'compare' ? 'overview' : (initialLens ?? 'overview'),
  );
  const [showAll, setShowAll] = useState(false);
  const [fullReport, setFullReport] = useState(false);

  const original = detail?.original ?? null;
  const sellJob = classifyObjective(original?.objective) === 'SELL';
  const onReport = useCallback(
    (data: DeliveryReport | null, status: string) => {
      setReport({ data, status });
      if (!arriving.current || status === 'loading') return;
      arriving.current = false;
      setWaiting(false);
      const e = data?.missions[0]?.experience;
      const something =
        status === 'ready' && e
          ? sellJob
            ? e.shortlist.length > 0
            : e.quotations.some((q) => isCurrentOffer(e, q))
          : false;
      // A report that could not be read opens the comparison, where the report's own message says why.
      if (something || status !== 'ready') setLens('compare');
      else setNothingToCompare(true);
    },
    [sellJob],
  );
  // CQ-23: the same plain title as the requests list ("Sell in Spain").
  const title = requestTitle(original) ?? (original?.objective?.trim() || '…');
  const day = (value: string) => formatDateTime(value, { locale });
  const family = classifyObjective(original?.objective);
  const journey = family === 'UNCLASSIFIED' ? null : family;
  const source = family === 'SOURCE';
  // The route is the customer's own brief: where their company is, and the market they chose.
  // The intake stores both inside the brief's experience (Codex review of PR 314); a top-level value is kept as a
  // fallback for older briefs.
  const from = (original?.experience?.companyCountry ?? original?.companyCountry)?.trim();
  const to = (original?.market ?? original?.marketCode ?? original?.experience?.marketCode)?.trim();
  const route = from && to ? `${placeName(from)} → ${placeName(to)}` : null;
  const replies = detail?.progress
    ? [...detail.progress.replies].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const shown = showAll ? replies : replies.slice(0, 1);
  const savedResourceId = saved?.resourceId ?? link.savedResourceId;
  const hasReport = link.reportAvailable || !!saved;
  const reportHref = savedResourceId ? `/account/missions/${savedResourceId}` : null;
  // A report saved here is done; otherwise the server's answer says what is left to save.
  const saveTask = saved || unreadable ? null : task;
  // Reports the server refused in this visit are gone from the offer; the Room says so once below the card.
  const [refused, setRefused] = useState<string[]>([]);
  const toSave = (
    saveTask?.kind === 'save'
      ? [saveTask.report]
      : saveTask?.kind === 'choose'
        ? saveTask.reports
        : []
  ).filter((report) => !refused.includes(report.assignmentId));
  // A waiting arrival with no saved report has nothing to wait for.
  const opening = waiting && !!savedResourceId;
  function onSaved(assignmentId: string, resourceId: string) {
    // Without the lenses there is no comparison here: the saved report opens on its own page, as in the Library.
    if (!lenses) {
      router.push('/account/missions/' + resourceId);
      return;
    }
    setSaved({ assignmentId, resourceId });
    setReport({ data: null, status: 'loading' });
    setNothingToCompare(false);
    setLens('overview');
    arriving.current = true;
    setWaiting(true);
    router.replace(afterSaveHref(requestId, assignmentId, reportCount), { scroll: false });
  }
  const helpHref = `/account/service-requests/new?kind=request&ref=${encodeURIComponent(requestId)}`;
  const status = detail?.progress?.status ?? null;
  const subline = status
    ? (labels.road.sublines[status as keyof typeof labels.road.sublines] ?? null)
    : null;

  // The one next step, from records only: quotes to compare, a report to save, or what the team is doing.
  const experience = report.data?.missions[0]?.experience ?? null;
  const quotes = experience
    ? experience.quotations.filter((q) => isCurrentOffer(experience, q))
    : [];
  const sell = family === 'SELL';
  const mission = report.data?.missions[0] ?? null;
  const board = sell && experience ? sellFacts([experience]) : null;
  const lensWords = (item: Lens) =>
    source ? sourceLensWords[item] : sell ? sellLensWords[item] : say(lensKey[item]);
  const lensLang = (item: Lens) =>
    (source || sell || item === 'trip') && locale !== 'en' ? 'en' : undefined;
  const next: {
    words: string;
    small: string;
    act: 'compare' | 'lens' | 'report' | 'library' | 'help' | 'request' | 'save' | 'retry';
    lens?: Lens;
    label?: string;
  } =
    unreadable && !saved
      ? {
          words: 'We could not check this report just now.',
          small: 'Nothing was saved and nothing has changed.',
          act: 'retry',
        }
      : toSave.length
        ? {
            words:
              toSave.length > 1
                ? 'Your reports are ready'
                : `Your report is ready: ${toSave[0]!.title}`,
            small:
              toSave.length > 1
                ? 'Choose the report to save. Each one is saved on its own.'
                : 'Save it here to read and compare it in this room.',
            act: 'save',
          }
        : lenses && board && board.proposed > 0
          ? {
              words: `Review ${board.proposed === 1 ? 'the proposed meeting' : `${board.proposed} proposed meetings`}`,
              // Only point to where the times are, and ask for a reply only where the question link is beside it.
              // With the Trip switch off the room has no Meetings view, so the times are in the saved report.
              small: `${trip ? 'See the proposed times in Meetings' : 'The proposed times are in your saved report'}${serviceRequestsEnabled ? ', then tell the Corridra team which work for you.' : '.'}`,
              act: trip ? 'lens' : 'report',
              lens: 'trip',
              label: trip ? 'See Meetings' : 'Open the Saved Report',
            }
          : lenses && board && board.shortlisted > 0
            ? {
                words: `Review ${board.shortlisted === 1 ? 'the shortlisted buyer' : `${board.shortlisted} shortlisted buyers`}`,
                small: serviceRequestsEnabled
                  ? 'See how each buyer fits and how it is backed, then tell us whom to meet.'
                  : 'See how each buyer fits and how it is backed.',
                act: 'lens',
                lens: 'compare',
                label: 'See Buyers',
              }
            : !sell && lenses && quotes.length > 0
              ? {
                  words: `Compare ${quotes.length === 1 ? 'the quote' : `${quotes.length} quotes`}`,
                  small: serviceRequestsEnabled
                    ? 'See how each supplier is backed and what is missing, then tell us which to visit.'
                    : 'See how each supplier is backed and what is missing.',
                  act: 'compare',
                }
              : hasReport && !savedResourceId && refused.length === 0
                ? {
                    words: 'Your report is ready',
                    small: 'Save it from your Library to read and compare it here.',
                    act: 'library',
                  }
                : {
                    words: subline ?? 'Waiting on the Corridra team',
                    small: replies[0]
                      ? `Latest reply ${day(replies[0].createdAt)}.`
                      : 'The Corridra team will tell you here when something needs you.',
                    act: serviceRequestsEnabled ? 'help' : 'request',
                  };

  // Everything the report page shows for the comparison stays one tap away: the requirement, the shortlist,
  // every offer with its evidence lens, the cards and the original table.
  const fullToggle = (
    <button
      type="button"
      className="text-link room-full"
      aria-expanded={fullReport}
      onClick={() => setFullReport((v) => !v)}
    >
      {fullReport
        ? 'Hide the Requirement, Shortlist and Every Offer'
        : 'Show the Requirement, Shortlist and Every Offer'}
    </button>
  );
  const reportSection: ReportSection =
    lens === 'overview'
      ? 'none'
      : lens === 'compare'
        ? fullReport || (report.status !== 'ready' && report.status !== 'loading')
          ? 'compare'
          : 'none'
        : lens;

  const lensItems: Lens[] = trip
    ? sell
      ? ['overview', 'compare', 'trip', 'evidence']
      : ['overview', 'compare', 'evidence', 'trip']
    : ['overview', 'compare', 'evidence'];
  const lensCount = (item: Lens) => {
    if (item === 'compare') {
      const n = sell ? (experience?.shortlist.length ?? 0) : quotes.length;
      return n > 0 ? n : undefined;
    }
    if (item === 'trip' && sell && mission && mission.itinerary.length > 0)
      return mission.itinerary.length;
    return undefined;
  };

  return (
    <div
      className="room"
      lang={html}
      dir={dir}
      data-journey={journey ? journeyKey[journey] : undefined}
    >
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
            <div className="room-tags" lang="en">
              {journey ? (
                <span className="room-tag" data-journey={journeyKey[journey]}>
                  {journeyWords[journey]}
                </span>
              ) : null}
              {route ? (
                <span className="room-route">
                  <CorridraIcon name="globe" />
                  {route}
                </span>
              ) : null}
              <ModeLabel real={realCustomerInput()} labels={labels.mode} />
            </div>
            <h2 dir="auto">{title}</h2>
            <p className="room-meta">
              {original?.market ? `${placeName(original.market)} · ` : ''}
              {fill(say('room.received'), {
                date: day(detail.progress.receivedAt),
              })}
            </p>
            <div className="room-stage">
              <StageBar
                status={detail.progress.status}
                records={roadRecords(link)}
                labels={labels.road}
                name={title}
                named
              />
            </div>
          </header>

          <section className="room-next" aria-label="Your next step" lang="en">
            <span className="room-next-mark" aria-hidden="true">
              <CorridraIcon name="arrow" />
            </span>
            <span className="room-next-words">
              <small>Your next step</small>
              <b>{next.words}</b>
              <span>{next.small}</span>
            </span>
            <span className="room-next-actions">
              {(next.act === 'compare' || next.act === 'lens' || next.act === 'report') &&
              serviceRequestsEnabled ? (
                <Link prefetch={false} className="text-link" href={helpHref}>
                  Ask a Question
                </Link>
              ) : null}
              {next.act === 'retry' ? (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => router.refresh()}
                >
                  Try Again
                </button>
              ) : next.act === 'save' ? null : next.act === 'compare' ? (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => setLens('compare')}
                >
                  Compare Quotes
                </button>
              ) : next.act === 'lens' ? (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => setLens(next.lens ?? 'compare')}
                >
                  {next.label}
                </button>
              ) : next.act === 'report' && reportHref ? (
                <Link prefetch={false} className="button button-primary" href={reportHref}>
                  {next.label}
                </Link>
              ) : next.act === 'library' ? (
                <Link
                  prefetch={false}
                  className="button button-primary"
                  href="/account?view=results"
                >
                  Open Your Library
                </Link>
              ) : next.act === 'help' ? (
                <Link prefetch={false} className="button button-primary" href={helpHref}>
                  Ask a Question
                </Link>
              ) : (
                <Link
                  prefetch={false}
                  className={next.act === 'request' ? 'text-link' : 'button button-primary'}
                  href={`/account/requests/${requestId}`}
                >
                  Open the Request
                </Link>
              )}
            </span>
            {next.act === 'save' ? (
              <RoomSave
                reports={toSave}
                subject={subject}
                issuer={issuer}
                onSaved={onSaved}
                onRefused={(id) => setRefused((ids) => [...ids, id])}
              />
            ) : null}
          </section>

          {refused.length > 0 && !saved ? (
            <p role="status" className="room-note" lang="en">
              This report is no longer open to you. Nothing was saved.
            </p>
          ) : null}
          {hintClosed && !saved ? (
            <p role="status" className="room-note" lang="en">
              This report is no longer open to you.{' '}
              <Link
                prefetch={false}
                className="text-link"
                href="/account?view=results&tab=delivered"
              >
                Open Your Library
              </Link>
            </p>
          ) : null}
          {opening ? (
            <p role="status" className="room-note" lang="en">
              Opening your saved report…
            </p>
          ) : null}
          {nothingToCompare && reportHref ? (
            <p role="status" className="room-note" lang="en">
              {sellJob
                ? 'Your report is saved. There are no buyers to compare yet.'
                : 'Your report is saved. There are no current quotes to compare yet.'}{' '}
              <Link prefetch={false} className="text-link" href={reportHref}>
                Open the Saved Report
              </Link>
            </p>
          ) : null}

          {lenses && (
            <div className="room-lenses" role="group" aria-label={say('room.lens.overview')}>
              {lensItems.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="room-lens"
                  aria-pressed={lens === item}
                  data-count={lensCount(item)}
                  onClick={() => {
                    arriving.current = false;
                    setWaiting(false);
                    setNothingToCompare(false);
                    setLens(item);
                  }}
                >
                  {/* An English word until native review (D16), marked so it is read as English. */}
                  <span lang={lensLang(item)}>{lensWords(item)}</span>
                </button>
              ))}
            </div>
          )}

          {(!lenses || lens === 'overview') && (
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
                    <time dateTime={reply.createdAt}>{day(reply.createdAt)}</time>
                  </div>
                ))
              )}
              {replies.length > 1 && (
                <button type="button" className="text-link" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? '−' : '+'} {say('room.replies.all')}
                </button>
              )}
            </section>
          )}

          {lenses && lens === 'compare' && savedResourceId && (
            <div className="room-compare" lang="en" dir="ltr">
              {report.status === 'loading' && <p role="status">Opening your approved report…</p>}
              {report.status === 'ready' &&
                (experience ? (
                  sell ? (
                    <SellBoard
                      experience={experience}
                      outcomes={mission?.outcomes ?? null}
                      more={fullToggle}
                    />
                  ) : (
                    <>
                      <MissingTermNotice
                        experience={experience}
                        action={
                          serviceRequestsEnabled ? (
                            <Link prefetch={false} className="text-link" href={helpHref}>
                              Ask a Question
                            </Link>
                          ) : null
                        }
                      />
                      <SourceLedger experience={experience} language={locale} more={fullToggle} />
                    </>
                  )
                ) : (
                  <>
                    <p className="ux-empty" role="status">
                      No company shortlist or supplier quotation has been approved for this report
                      yet.
                    </p>
                    {fullToggle}
                  </>
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

          {/* One report component for every view, always in this place, so the report is read once and
              anything typed in it survives a switch. The Overview and the comparison summary draw nothing
              from it (section none); the full comparison, Evidence and Trip draw their own part. A report
              that could not be read shows the report's own message in the comparison. */}
          {lenses && savedResourceId ? (
            <div lang="en" dir="ltr" className="room-report">
              <SavedCommercialReport
                resourceId={savedResourceId}
                subject={subject}
                issuer={issuer}
                decisionsEnabled={decisionsEnabled}
                specificationConfirmationsEnabled={specificationConfirmationsEnabled}
                lenses
                section={reportSection}
                renderTrip={(itinerary) => <TripList itinerary={itinerary} locale={locale} />}
                onReport={onReport}
              />
            </div>
          ) : lenses && lens !== 'overview' ? (
            <p className="ux-empty" role="status">
              {say(lens === 'trip' ? 'room.trip.noReport' : 'room.lens.none')}
            </p>
          ) : null}

          {/* The original pages, on the Overview: one tap away from every view. */}
          {(!lenses || lens === 'overview') && (
            <div className="room-actions">
              <Link prefetch={false} className="text-link" href={`/account/requests/${requestId}`}>
                {say('room.open.request')}
              </Link>
              {serviceRequestsEnabled && (
                <Link prefetch={false} className="text-link" href={helpHref}>
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
          )}
        </>
      )}
    </div>
  );
}
