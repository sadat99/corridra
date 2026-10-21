'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshButton } from '../refresh-button';
import { briefSchema, missionStatus, type MissionBrief } from '@corridra/domain/missions';
import { displayMoney, displayDate } from '@corridra/domain/locale';

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
type Scope = { requestId: string; subject: string; issuer: string };
const labels: Record<string, string> = {
  objective: 'Commercial objective',
  market: 'Target country or market',
  attendance: 'Visit planned',
  startDate: 'Start date',
  endDate: 'End date',
  timezone: 'Time zone',
  offer: 'Offering or requirement',
  website: 'Website',
  outcomes: 'Desired outcomes',
  notes: 'Additional notes',
  name: 'Contact name',
  company: 'Company',
  email: 'Contact email',
  acknowledged: 'Sample-data notice acknowledged',
  experience: 'Commercial requirements',
  schemaVersion: 'Request format version',
  companyCountry: 'Company country',
  marketCode: 'Target country or trade bloc',
  job: 'Type of work',
  requirements: 'Requirements',
  budgetMinor: 'Budget in original minor units',
  currency: 'Original currency',
  budgetBasis: 'Budget basis',
  moq: 'Minimum order quantity (MOQ)',
  oemOdm: 'Custom manufacturing (OEM / ODM)',
  incoterm: 'Delivery term (Incoterm)',
  machinery: 'Machinery requirements',
};
function label(key: string) {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2');
  return labels[key] ?? words.charAt(0).toUpperCase() + words.slice(1);
}
function OriginalFields({ value }: { value: Record<string, unknown> }) {
  return (
    <dl className="ux-request-original">
      {Object.entries(value).map(([key, item]) => (
        <div key={key} className="ux-fact-row">
          <dt>
            <strong>{label(key)}</strong>
          </dt>
          <dd style={{ marginInlineStart: 0, whiteSpace: 'pre-wrap' }}>
            {item && typeof item === 'object' && !Array.isArray(item) ? (
              <OriginalFields value={item as Record<string, unknown>} />
            ) : Array.isArray(item) ? (
              <ul>
                {item.map((entry, index) => (
                  <li key={index}>{String(entry)}</li>
                ))}
              </ul>
            ) : typeof item === 'boolean' ? (
              item ? (
                'Yes'
              ) : (
                'No'
              )
            ) : item === '' || item == null ? (
              'Not provided'
            ) : (
              String(item)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function checked(value: unknown, requestId: string): Detail {
  const d = value as Partial<Detail> | null;
  if (!d || d.id !== requestId || (value as { synthetic?: unknown }).synthetic !== true)
    throw new Error('failed');
  if (d.available === false && d.original === null && d.progress === null) return d as Detail;
  if (
    d.available !== true ||
    !briefSchema.safeParse(d.original).success ||
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
function PrivateDetail({ requestId, subject, issuer }: Scope) {
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
            error instanceof Error && ['denied', 'unavailable'].includes(error.message)
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
  const original = detail?.original;
  const requirements = original?.experience?.requirements;
  return (
    <section aria-label="Private saved request" className="ux-request-page">
      <a className="text-link ux-back" href="/account#customer-requests">
        Back to my saved requests
      </a>
      <p>Sample data only. A request is not an accepted engagement, confirmed meeting or deal.</p>
      {status === 'loading' && <p role="status">Loading your saved request…</p>}
      {status === 'denied' && (
        <div role="alert">
          <p>Your private request access could not be confirmed. No request details are shown.</p>
          <a className="text-link" href="/signin">
            Sign in again
          </a>
        </div>
      )}
      {status === 'unavailable' && (
        <p role="status">
          Saved sample request details are unavailable. Your receipts and shared mission links are
          separate.
        </p>
      )}
      {status === 'failed' && <p role="alert">Your request could not be loaded. Try again.</p>}
      {status === 'ready' &&
        detail &&
        (!detail.available ? (
          <p role="status">
            The original request is no longer available. Its retention period may have ended.
          </p>
        ) : (
          <>
            <section aria-label="Request overview" className="detail-card">
              <h2>{original?.objective}</h2>
              <p>{original?.market}</p>
              <p>
                Mission status: <strong>{detail.progress?.status}</strong>
              </p>
              <p>
                Received{' '}
                {detail.progress && (
                  <time dateTime={detail.progress.receivedAt}>
                    {displayDate(detail.progress.receivedAt)}
                  </time>
                )}
              </p>
            </section>
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
                <OriginalFields value={original} />
              </details>
            )}
          </>
        ))}
      {status !== 'loading' && status !== 'denied' && (
        <RefreshButton
          label="request details"
          onClick={() => {
            setDetail(null);
            setStatus('loading');
            read();
          }}
        />
      )}
      <details className="ux-journey-disclosure">
        <summary>Request reference</summary>
        <p>{requestId}</p>
      </details>
    </section>
  );
}
