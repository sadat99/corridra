'use client';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshButton } from './refresh-button';
import { StatusChip } from '../../components/ux/status-chip';
import { customerStatusLabel } from '../../lib/ux/customer-road';
import { formatDateTime } from '../../lib/ux/format';

type RequestRow = {
  id: string;
  workspaceId: string;
  createdAt: string;
  synthetic: boolean;
  available: boolean;
  /** CQ-23: the objective and market the customer chose, for example "Sell in Spain". */
  title?: string;
  progress: null | {
    status: string;
    receivedAt: string;
    replies: { body: string; createdAt: string }[];
  };
};
type Page = { requests: RequestRow[]; nextAfter: string | null; synthetic: boolean };
type Status = 'loading' | 'ready' | 'denied' | 'unavailable' | 'failed';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function row(value: unknown, statuses: readonly string[]): value is RequestRow {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<RequestRow>;
  if (
    typeof r.id !== 'string' ||
    !uuid.test(r.id) ||
    typeof r.workspaceId !== 'string' ||
    !uuid.test(r.workspaceId) ||
    !date(r.createdAt) ||
    !customerProvenanceAllowed(r.synthetic)
  )
    return false;
  if (r.available === false) return r.progress === null;
  if (
    r.available !== true ||
    !r.progress ||
    typeof r.progress.status !== 'string' ||
    !statuses.includes(r.progress.status) ||
    !date(r.progress.receivedAt) ||
    !Array.isArray(r.progress.replies)
  )
    return false;
  return r.progress.replies.every(
    (reply) => reply && typeof reply.body === 'string' && date(reply.createdAt),
  );
}
async function fetchPage(
  subject: string,
  issuer: string,
  signal: AbortSignal,
  statuses: readonly string[],
  after?: string,
): Promise<Page> {
  const response = await fetch(
    '/api/customer-requests' + (after ? '?after=' + encodeURIComponent(after) : ''),
    {
      cache: 'no-store',
      signal,
      headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 403 || response.status === 409
        ? 'denied'
        : response.status === 503
          ? 'unavailable'
          : 'failed',
    );
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object') throw new Error('failed');
  const page = value as Partial<Page>;
  if (
    !customerProvenanceAllowed(page.synthetic) ||
    !Array.isArray(page.requests) ||
    !page.requests.every((value) => row(value, statuses)) ||
    !(page.nextAfter === null || (typeof page.nextAfter === 'string' && uuid.test(page.nextAfter)))
  )
    throw new Error('failed');
  return page as Page;
}
function time(value: string) {
  return formatDateTime(value);
}

export function CustomerRequests(props: {
  subject: string;
  issuer: string;
  statuses: readonly string[];
  canSubmit?: boolean;
  detailsEnabled?: boolean;
}) {
  return <PrivateRequests key={props.issuer + ':' + props.subject} {...props} />;
}
function PrivateRequests({
  subject,
  issuer,
  statuses,
  canSubmit = false,
  detailsEnabled = false,
}: {
  subject: string;
  issuer: string;
  statuses: readonly string[];
  canSubmit?: boolean;
  detailsEnabled?: boolean;
}) {
  const [status, setStatus] = useState<Status>('loading');
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const failed = useCallback((error: unknown) => {
    setRequests([]);
    setNextAfter(null);
    setStatus(
      error instanceof Error && ['denied', 'unavailable'].includes(error.message)
        ? (error.message as Status)
        : 'failed',
    );
  }, []);
  useEffect(() => {
    function read() {
      controller.current?.abort();
      const pending = new AbortController();
      controller.current = pending;
      void fetchPage(subject, issuer, pending.signal, statuses)
        .then((page) => {
          if (pending.signal.aborted) return;
          setRequests(page.requests);
          setNextAfter(page.nextAfter);
          setStatus('ready');
        })
        .catch((error) => {
          if (!pending.signal.aborted) failed(error);
        });
    }
    function clear() {
      controller.current?.abort();
      setRequests([]);
      setNextAfter(null);
      setBusy(false);
      setStatus('loading');
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) {
        clear();
        read();
      }
    }
    function visibility() {
      if (document.visibilityState === 'hidden') clear();
      else read();
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
  }, [subject, issuer, statuses, failed]);
  async function load(after?: string) {
    if (busy) return;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    try {
      const page = await fetchPage(subject, issuer, pending.signal, statuses, after);
      if (pending.signal.aborted) return;
      setRequests((previous) =>
        after
          ? [
              ...previous,
              ...page.requests.filter((item) => !previous.some((old) => old.id === item.id)),
            ]
          : page.requests,
      );
      setNextAfter(page.nextAfter);
      setStatus('ready');
    } catch (error) {
      if (!pending.signal.aborted) failed(error);
    } finally {
      if (!pending.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      aria-labelledby="private-requests-heading"
      className="detail-card ux-account-missions"
      aria-busy={status === 'loading' || busy}
    >
      <div className="ux-section-head">
        <h2 id="private-requests-heading">Saved requests</h2>
        {status !== 'loading' && status !== 'denied' && (
          <RefreshButton label="saved requests" busy={busy} onClick={() => void load()} />
        )}
      </div>
      <p>
        Only requests saved privately to this account appear here. Team membership does not share
        private requests.
      </p>
      {status === 'loading' && <p role="status">Loading your saved requests…</p>}
      {status === 'denied' && (
        <div role="alert">
          <p>
            Your private request access could not be confirmed. Sign in again or ask the Corridra
            team about your access.
          </p>
          <a className="text-link" href="/signin">
            Sign in again
          </a>
        </div>
      )}
      {status === 'unavailable' && (
        <p role="status">
          Saved request access is unavailable. Your existing receipts and shared mission links are
          separate.
        </p>
      )}
      {status === 'failed' && (
        <p role="alert">Your saved requests could not be loaded. Try again.</p>
      )}
      {status === 'ready' && requests.length === 0 && (
        <p className="ux-empty">
          No saved requests yet. Choose a workspace to send your first one.
        </p>
      )}
      {status === 'ready' &&
        requests.map((request) => (
          <article
            key={request.id}
            className="detail-card"
            aria-label={(request.title ?? 'Request') + ', sent ' + time(request.createdAt)}
          >
            <h3>{request.title ?? 'Request sent ' + time(request.createdAt)}</h3>
            {detailsEnabled && (
              <a className="text-link" href={'/account/requests/' + request.id}>
                Open request details
              </a>
            )}
            <p>
              Sent <time dateTime={request.createdAt}>{time(request.createdAt)}</time>
            </p>
            {request.available && request.progress ? (
              <>
                <p>
                  Status: <StatusChip status={customerStatusLabel(request.progress.status, true)} />
                </p>
                <p>A saved request is not an accepted engagement, confirmed meeting or deal.</p>
                <h4>Replies from the Corridra team</h4>
                {request.progress.replies.length === 0 ? (
                  <p className="ux-empty">No replies yet.</p>
                ) : (
                  request.progress.replies.map((reply, index) => (
                    <div key={index}>
                      <p>{reply.body}</p>
                      <p>
                        <time dateTime={reply.createdAt}>{time(reply.createdAt)}</time>
                      </p>
                    </div>
                  ))
                )}
              </>
            ) : (
              <p>
                The original request progress is no longer available. Its retention period may have
                ended.
              </p>
            )}
            <details className="ux-journey-disclosure">
              <summary>Request reference</summary>
              <p>{request.id}</p>
            </details>
          </article>
        ))}
      {status === 'ready' && nextAfter && (
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => void load(nextAfter)}
        >
          Load more saved requests
        </button>
      )}
      {canSubmit ? (
        <p>
          <a className="text-link" href="/account#customer-workspaces">
            New request
          </a>
        </p>
      ) : (
        <p>
          New account request submission is not available here yet. Requests sent through the public
          form still need their private receipt.
        </p>
      )}
    </section>
  );
}
