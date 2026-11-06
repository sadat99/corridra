'use client';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshButton } from './refresh-button';
import { StatusChip } from '../../components/ux/status-chip';
import { customerStatusLabel } from '../../lib/ux/customer-road';
import { formatDateTime } from '../../lib/ux/format';
import { Dialog } from '../../components/ux/dialog';
import { SegmentedFilter } from '../../components/ux/segmented-filter';
import { limitWords, notReachedWords } from '../../lib/account-limit';

type RequestRow = {
  id: string;
  workspaceId: string;
  createdAt: string;
  synthetic: boolean;
  available: boolean;
  /** Set when the person withdrew the request; absent where the withdrawal module is not installed. */
  withdrawn?: boolean;
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
type Wd = { open: boolean; reasons: Record<string, { at: string; reason: string }> };
const noWithdrawals: Wd = { open: false, reasons: {} };
/** What withdrawing offers. Anything that goes wrong here leaves the list as it was, with no withdraw action. */
async function fetchWithdrawals(subject: string, issuer: string, signal: AbortSignal): Promise<Wd> {
  try {
    const response = await fetch('/api/customer-request-withdrawals', {
      cache: 'no-store',
      signal,
      headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
    });
    if (!response.ok) return noWithdrawals;
    const value = (await response.json()) as {
      open?: unknown;
      items?: { requestId?: unknown; at?: unknown; reason?: unknown }[];
    };
    const reasons: Wd['reasons'] = {};
    for (const item of Array.isArray(value.items) ? value.items : [])
      if (typeof item.requestId === 'string' && typeof item.reason === 'string' && date(item.at))
        reasons[item.requestId] = { at: item.at, reason: item.reason };
    return { open: value.open === true, reasons };
  } catch {
    return noWithdrawals;
  }
}
const readFilter = () =>
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('status') === 'withdrawn'
    ? 'withdrawn'
    : 'active';
// Counted in characters, the way the database counts them, not in UTF-16 units.
const reasonLength = (value: string) => [...value.trim()].length;
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
  const [wd, setWd] = useState<Wd>(noWithdrawals);
  const [filter, setFilter] = useState<'active' | 'withdrawn'>(readFilter);
  const [asking, setAsking] = useState<RequestRow | null>(null);
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<{ id: string; text: string; alert?: boolean } | null>(null);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  // One command id per decision, so a lost answer is retried as the same request.
  const commands = useRef(new Map<string, string>());
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
  useEffect(() => {
    if (status !== 'ready') return;
    const pending = new AbortController();
    void fetchWithdrawals(subject, issuer, pending.signal).then((value) => {
      if (!pending.signal.aborted) setWd(value);
    });
    return () => pending.abort();
  }, [status, subject, issuer]);
  // The undo offer lasts ten seconds; restoring stays possible from Withdrawn after that.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), 10_000);
    return () => clearTimeout(timer);
  }, [undo]);
  const title = (request: RequestRow) => request.title ?? 'Request sent ' + time(request.createdAt);
  function chooseFilter(next: 'active' | 'withdrawn') {
    setFilter(next);
    const url = new URL(window.location.href);
    if (next === 'withdrawn') url.searchParams.set('status', 'withdrawn');
    else url.searchParams.delete('status');
    window.history.replaceState(null, '', url);
  }
  async function decide(request: RequestRow, withdraw: boolean, why = '') {
    if (working) return false;
    if (typeof crypto.randomUUID !== 'function') {
      setNote({
        id: request.id,
        text: 'Use a current browser to change this securely.',
        alert: true,
      });
      return false;
    }
    const key = `${request.id}:${withdraw}`;
    const commandId = commands.current.get(key) ?? crypto.randomUUID();
    commands.current.set(key, commandId);
    setWorking(true);
    setNote(null);
    try {
      const response = await fetch('/api/customer-request-withdrawals', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-corridra-customer-subject': subject,
          'x-corridra-customer-issuer': issuer,
        },
        body: JSON.stringify(
          withdraw
            ? { action: 'withdraw', requestId: request.id, commandId, reason: why.trim() }
            : { action: 'restore', requestId: request.id, commandId },
        ),
      });
      const data: { withdrawn?: unknown; reason?: unknown } | null = await response
        .json()
        .catch(() => null);
      if (!response.ok || typeof data?.withdrawn !== 'boolean') {
        setNote({
          id: request.id,
          alert: true,
          text:
            response.status === 429
              ? limitWords
              : response.status === 403
                ? 'This request is not available to change.'
                : response.status === 400
                  ? 'Check the reason: it needs 10 to 500 characters.'
                  : response.status === 503
                    ? 'Withdrawing a request is unavailable right now.'
                    : 'The change was not confirmed. Try the same request again.',
        });
        return false;
      }
      if (data.reason === 'closed' || data.reason === 'not-withdrawable') {
        setNote({
          id: request.id,
          alert: true,
          text:
            data.reason === 'closed'
              ? 'Withdrawing requests is not open yet.'
              : 'This request is closed, so there is nothing left to withdraw.',
        });
        return false;
      }
      commands.current.delete(key);
      const now = new Date().toISOString();
      setRequests((all) =>
        all.map((one) =>
          one.id === request.id ? { ...one, withdrawn: data.withdrawn as boolean } : one,
        ),
      );
      setWd((value) => {
        const reasons = { ...value.reasons };
        if (withdraw) reasons[request.id] = { at: now, reason: why.trim() };
        else delete reasons[request.id];
        return { ...value, reasons };
      });
      if (withdraw) setUndo({ id: request.id, title: title(request) });
      else {
        setUndo(null);
        setNote({ id: request.id, text: 'Request restored.' });
      }
      return true;
    } catch {
      setNote({ id: request.id, alert: true, text: notReachedWords });
      return false;
    } finally {
      setWorking(false);
    }
  }
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
  // Every withdrawal the person has, including ones on pages not loaded yet: the list of reasons is complete.
  const loadedWithdrawn = requests.filter((one) => one.withdrawn === true);
  const withdrawnCount = new Set([
    ...Object.keys(wd.reasons),
    ...loadedWithdrawn.map((one) => one.id),
  ]).size;
  const showFilter = status === 'ready' && (wd.open || withdrawnCount > 0);
  const visible = showFilter
    ? requests.filter((one) => (one.withdrawn === true) === (filter === 'withdrawn'))
    : requests;
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
      {showFilter && (
        <SegmentedFilter
          label="Show"
          value={filter}
          onChange={chooseFilter}
          options={[
            { value: 'active', label: 'Active', count: requests.length - loadedWithdrawn.length },
            { value: 'withdrawn', label: 'Withdrawn', count: withdrawnCount },
          ]}
        />
      )}
      {undo && (
        <p role="status" className="ux-undo">
          {undo.title} was withdrawn.{' '}
          <button
            type="button"
            className="text-link"
            disabled={working}
            onClick={() => {
              const request = requests.find((one) => one.id === undo.id);
              if (request) void decide(request, false);
            }}
          >
            Undo
          </button>
        </p>
      )}
      {status === 'ready' &&
        showFilter &&
        filter === 'withdrawn' &&
        nextAfter &&
        loadedWithdrawn.length < withdrawnCount && (
          <p className="ux-empty">
            Some withdrawn requests are on later pages. Choose Load More Saved Requests to see them.
          </p>
        )}
      {status === 'ready' && visible.length === 0 && (
        <p className="ux-empty">
          {showFilter && filter === 'withdrawn'
            ? 'No withdrawn requests.'
            : showFilter
              ? 'No active requests. The ones you withdrew are under Withdrawn.'
              : 'No saved requests yet. Choose a workspace to send your first one.'}
        </p>
      )}
      {status === 'ready' &&
        visible.map((request) => (
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
            {request.withdrawn === true && (
              <p>
                You withdrew this request
                {wd.reasons[request.id] && (
                  <>
                    {' on '}
                    <time dateTime={wd.reasons[request.id]!.at}>
                      {time(wd.reasons[request.id]!.at)}
                    </time>
                    . Only you can see your reason: {wd.reasons[request.id]!.reason}
                  </>
                )}
                {!wd.reasons[request.id] && '.'}
              </p>
            )}
            {request.withdrawn === true ? (
              <p>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={working}
                  onClick={() => void decide(request, false)}
                >
                  Restore Request
                </button>
              </p>
            ) : (
              wd.open &&
              request.available &&
              request.progress?.status !== 'CLOSED' &&
              request.progress?.status !== 'CANCELLED' && (
                <p>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={working}
                    onClick={() => {
                      setReason('');
                      setNote(null);
                      setAsking(request);
                    }}
                  >
                    Withdraw Request
                  </button>
                </p>
              )
            )}
            {note?.id === request.id && <p role={note.alert ? 'alert' : 'status'}>{note.text}</p>}
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
          Load More Saved Requests
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
      <Dialog
        open={!!asking}
        onClose={() => setAsking(null)}
        title="Withdraw Request?"
        locked={working && !!asking}
      >
        {asking && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (reasonLength(reason) < 10 || reasonLength(reason) > 500) return;
              void decide(asking, true, reason).then((done) => {
                if (done) setAsking(null);
              });
            }}
          >
            <p>
              {title(asking)} stops showing as active work in your account and we stop emailing you
              about it. Nothing is deleted. You can restore it from Withdrawn at any time.
            </p>
            <label className="field">
              Why are you withdrawing it?
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                required
                aria-describedby="withdraw-reason-help"
              />
            </label>
            <p id="withdraw-reason-help" className="notifications-help">
              10 to 500 characters. Only you can see this reason.
            </p>
            {note?.id === asking.id && note.alert && <p role="alert">{note.text}</p>}
            <div className="ux-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                data-autofocus=""
                disabled={working}
                onClick={() => setAsking(null)}
              >
                Keep Request
              </button>
              <button
                type="submit"
                className="button button-secondary"
                data-intent="destructive"
                disabled={working || reasonLength(reason) < 10 || reasonLength(reason) > 500}
              >
                {working ? 'Please Wait…' : 'Withdraw Request'}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </section>
  );
}
