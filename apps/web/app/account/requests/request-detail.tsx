'use client';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { savedRequestBack, savedRequestHelper } from '../frame-copy';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshButton } from '../refresh-button';
import {
  briefSchema,
  realBriefSchema,
  missionStatus,
  type MissionBrief,
} from '@corridra/domain/missions';
import { displayMoney } from '@corridra/domain/locale';
import { StatusChip } from '../../../components/ux/status-chip';
import { customerStatusLabel } from '../../../lib/ux/customer-road';
import { formatDateTime } from '../../../lib/ux/format';
import { requestFacts, requestTitle } from '../request-words';
import { limitWords } from '../../../lib/account-limit';
import { classifyObjective } from '../../../lib/work-items/classify';
import { JourneyMismatchNote } from '../../../components/ux/journey-mismatch-note';
import { Place } from '../../../components/ux/flag';

const displayDate = (value: string) => formatDateTime(value);

type Detail = {
  id: string;
  available: boolean;
  original: MissionBrief | null;
  progress: null | {
    status: string;
    receivedAt: string;
    replies: { body: string; createdAt: string }[];
  };
};
type Scope = {
  requestId: string;
  subject: string;
  issuer: string;
  serviceRequestsEnabled?: boolean;
  /** The page frame shows the back link and the helper line; this section leaves them out. */
  framed?: boolean;
  /** The request's Room. Shown only beside a request the person may read, never beside a refusal (D-034). */
  roomHref?: string;
  /** The email reminder card, drawn by the page. Shown only beside a request the person may read. */
  nudge?: ReactNode;
  /** The request's short reference (RQ-000001), when the person's own list gave one. */
  reference?: string;
};
/** CQ-24 and D-017: the original brief in groups (Goal, Where, Details, Contact), each fact once, in plain words. */
function RequestFacts({ value }: { value: Record<string, unknown> }) {
  return (
    <>
      {requestFacts(value).map((group) => (
        <section key={group.title} aria-label={group.title}>
          <h3>{group.title}</h3>
          <dl className="ux-request-original">
            {group.rows.map((row) => (
              <div key={row.key} className="ux-fact-row">
                <dt>
                  <strong>{row.label}</strong>
                </dt>
                <dd style={{ marginInlineStart: 0, whiteSpace: 'pre-wrap' }}>
                  {Array.isArray(row.value) ? (
                    <ul>
                      {row.value.map((entry, index) => (
                        <li key={index}>{row.place ? <Place value={entry} /> : entry}</li>
                      ))}
                    </ul>
                  ) : row.place ? (
                    <Place value={row.value} />
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}
function checked(value: unknown, requestId: string): Detail {
  const d = value as Partial<Detail> | null;
  if (
    !d ||
    d.id !== requestId ||
    !customerProvenanceAllowed((value as { synthetic?: unknown }).synthetic)
  )
    throw new Error('failed');
  if (d.available === false && d.original === null && d.progress === null) return d as Detail;
  if (
    d.available !== true ||
    !((value as { synthetic?: boolean }).synthetic ? briefSchema : realBriefSchema).safeParse(
      d.original,
    ).success ||
    !d.progress ||
    !missionStatus.options.includes(d.progress.status as (typeof missionStatus.options)[number]) ||
    !Number.isFinite(Date.parse(d.progress.receivedAt)) ||
    !Array.isArray(d.progress.replies) ||
    !d.progress.replies.every(
      (r) => typeof r.body === 'string' && Number.isFinite(Date.parse(r.createdAt)),
    )
  )
    throw new Error('failed');
  return d as Detail;
}
export function CustomerRequestDetail(props: Scope) {
  return (
    <PrivateDetail
      key={JSON.stringify([props.issuer, props.subject, props.requestId])}
      {...props}
    />
  );
}
function PrivateDetail({
  requestId,
  subject,
  issuer,
  serviceRequestsEnabled = false,
  framed = false,
  roomHref,
  nudge,
  reference,
}: Scope) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [status, setStatus] = useState('loading');
  const controller = useRef<AbortController | null>(null);
  const read = useCallback(() => {
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    void fetch('/api/customer-requests/' + encodeURIComponent(requestId), {
      signal: pending.signal,
      cache: 'no-store',
      headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            [401, 403, 409].includes(response.status)
              ? 'denied'
              : response.status === 503
                ? 'unavailable'
                : response.status === 429
                  ? 'limit'
                  : 'failed',
          );
        const next = checked(await response.json(), requestId);
        if (!pending.signal.aborted) {
          setDetail(next);
          setStatus('ready');
        }
      })
      .catch((error) => {
        if (!pending.signal.aborted) {
          setDetail(null);
          setStatus(
            error instanceof Error && ['denied', 'unavailable', 'limit'].includes(error.message)
              ? error.message
              : 'failed',
          );
        }
      });
  }, [requestId, subject, issuer]);
  useEffect(() => {
    function clear() {
      controller.current?.abort();
      setDetail(null);
      setStatus('loading');
    }
    function visibility() {
      if (document.hidden) clear();
      else read();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) {
        clear();
        read();
      }
    }
    read();
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [read]);
  return (
    <RequestDetailView
      status={status}
      detail={detail}
      requestId={requestId}
      serviceRequestsEnabled={serviceRequestsEnabled}
      framed={framed}
      roomHref={roomHref}
      nudge={nudge}
      reference={reference}
      onRefresh={() => {
        setDetail(null);
        setStatus('loading');
        read();
      }}
    />
  );
}
/** What the person reads for each state of the request. No state of its own, so every state is drawn in a test. */
export function RequestDetailView({
  status,
  detail,
  requestId,
  serviceRequestsEnabled = false,
  framed = false,
  roomHref,
  nudge,
  reference,
  onRefresh,
}: {
  status: string;
  detail: Detail | null;
  requestId: string;
  serviceRequestsEnabled?: boolean;
  framed?: boolean;
  roomHref?: string;
  nudge?: ReactNode;
  reference?: string;
  onRefresh: () => void;
}) {
  const original = detail?.original;
  const requirements = original?.experience?.requirements;
  const readable = status === 'ready' && !!detail?.available;
  return (
    <section aria-label="Private saved request" className="ux-request-page">
      {!framed && (
        <>
          <a className="text-link ux-back" href={savedRequestBack.href}>
            {savedRequestBack.label}
          </a>
          <p> {savedRequestHelper} </p>
        </>
      )}
      {readable && roomHref && (
        <p>
          <a className="text-link" href={roomHref}>
            Open this request in its Room
          </a>
        </p>
      )}
      {readable && nudge}
      {status === 'loading' && <p role="status">Loading your saved request…</p>}
      {/* A refusal is the whole answer: no Room link, no email card and no reference, so nothing here says whether
          the request exists (D-034). */}
      {status === 'denied' && (
        <div role="alert">
          <p>Your private request access could not be confirmed. No request details are shown.</p>
          <a className="text-link" href={savedRequestBack.href}>
            {savedRequestBack.label}
          </a>
        </div>
      )}
      {status === 'unavailable' && (
        <p role="status">
          {realCustomerInput()
            ? 'Saved request details are unavailable. Your receipts and shared mission links are separate.'
            : 'Saved request details are unavailable. Your receipts and shared mission links are separate.'}{' '}
        </p>
      )}
      {status === 'failed' && <p role="alert">Your request could not be loaded. Try again.</p>}
      {status === 'limit' && <p role="alert">{limitWords}</p>}
      {status === 'ready' &&
        detail &&
        (!detail.available ? (
          <p role="status">
            The original request is no longer available. Its retention period may have ended.
          </p>
        ) : (
          <>
            <JourneyMismatchNote family={classifyObjective(original?.objective)} />
            <section aria-label="Request overview" className="detail-card">
              {reference ? (
                <p className="ux-hint" lang="en" data-request-reference>
                  {reference}
                </p>
              ) : null}
              <h2>{requestTitle(original) ?? original?.objective}</h2>
              {detail.progress && (
                <p>
                  Status: <StatusChip status={customerStatusLabel(detail.progress.status, true)} />
                </p>
              )}
              <p>
                Received{' '}
                {detail.progress && (
                  <time dateTime={detail.progress.receivedAt}>
                    {displayDate(detail.progress.receivedAt)}
                  </time>
                )}
              </p>
              <p>Reference: {requestId}</p>
              <p className="ux-hint">Quote this reference when you contact the Corridra team.</p>
            </section>
            {serviceRequestsEnabled && (
              <p>
                <a
                  className="text-link"
                  href={
                    '/account/service-requests/new?kind=request&ref=' +
                    encodeURIComponent(requestId)
                  }
                >
                  Request help with this
                </a>
              </p>
            )}
            <section aria-label="Team replies" className="detail-card">
              <h2>Replies from the Corridra team</h2>
              {detail.progress?.replies.length === 0 ? (
                <p className="ux-empty">No replies yet.</p>
              ) : (
                detail.progress?.replies.map((reply, index) => (
                  <article key={index}>
                    <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{reply.body}</p>
                    <time dateTime={reply.createdAt}>{displayDate(reply.createdAt)}</time>
                  </article>
                ))
              )}
            </section>
            {original && (
              <details className="ux-journey-disclosure" open>
                <summary>Original submitted requirements</summary>
                <p>
                  These are the details you submitted. They have not been verified by Corridra. A
                  budget is not a quotation, order, invoice or payment.
                </p>
                {requirements?.budgetMinor !== undefined && requirements.currency && (
                  <p>
                    Original budget:{' '}
                    <strong>{displayMoney(requirements.budgetMinor, requirements.currency)}</strong>{' '}
                    ({requirements.budgetBasis}). No currency conversion.
                  </p>
                )}
                <RequestFacts value={original as unknown as Record<string, unknown>} />
              </details>
            )}
          </>
        ))}
      {status !== 'loading' && status !== 'denied' && (
        <RefreshButton label="request details" onClick={onRefresh} />
      )}
      {status !== 'denied' && (
        <details className="ux-journey-disclosure">
          <summary>Request reference</summary>
          <p>{requestId}</p>
        </details>
      )}
    </section>
  );
}
