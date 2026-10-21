'use client';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { RefreshButton } from './refresh-button';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { displayDate } from '@corridra/domain/locale';
export type SavedMissionScope = { subject: string; issuer: string };
type Item = {
  id: string;
  available: boolean;
  removed: boolean;
  title?: string;
  expiresAt?: string;
};
type Page = { missions: Item[]; nextAfter: string | null; synthetic: boolean };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function item(value: unknown): value is Item {
  if (!value || typeof value !== 'object') return false;
  const row = value as Item;
  return (
    typeof row.id === 'string' &&
    uuid.test(row.id) &&
    typeof row.removed === 'boolean' &&
    (row.available === false ||
      (row.available === true &&
        typeof row.title === 'string' &&
        typeof row.expiresAt === 'string' &&
        Number.isFinite(Date.parse(row.expiresAt))))
  );
}
export async function savedMissionRead(response: Response) {
  if (!response.ok)
    throw new Error(
      [401, 403, 409].includes(response.status)
        ? 'denied'
        : response.status === 503
          ? 'unavailable'
          : 'failed',
    );
  return response.json() as Promise<unknown>;
}
export function savedMissionHeaders(scope: SavedMissionScope) {
  return {
    'Content-Type': 'application/json',
    'x-corridra-customer-subject': scope.subject,
    'x-corridra-customer-issuer': scope.issuer,
  };
}
export function SavedMissions(props: SavedMissionScope) {
  return <PrivateSavedMissions key={JSON.stringify([props.issuer, props.subject])} {...props} />;
}
function PrivateSavedMissions({ subject, issuer }: SavedMissionScope) {
  const [data, setData] = useState<Page | null>(null),
    [status, setStatus] = useState('loading'),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [pending, setPending] = useState<{ commandId: string; token: string } | null>(null);
  const controller = useRef<AbortController | null>(null),
    form = useRef<HTMLFormElement>(null),
    inFlight = useRef(false);
  const load = useCallback(
    (after?: string) => {
      controller.current?.abort();
      const task = new AbortController();
      controller.current = task;
      void fetch(
        '/api/customer-saved-missions' + (after ? '?after=' + encodeURIComponent(after) : ''),
        {
          cache: 'no-store',
          signal: task.signal,
          headers: savedMissionHeaders({ subject, issuer }),
        },
      )
        .then(savedMissionRead)
        .then((value) => {
          const page = value as Page;
          if (
            !customerProvenanceAllowed(page?.synthetic) ||
            !Array.isArray(page.missions) ||
            !page.missions.every(item) ||
            !(
              page.nextAfter === null ||
              (typeof page.nextAfter === 'string' && uuid.test(page.nextAfter))
            )
          )
            throw new Error('failed');
          if (!task.signal.aborted) {
            setData((old) => ({
              ...page,
              missions: after ? [...(old?.missions ?? []), ...page.missions] : page.missions,
            }));
            setStatus('ready');
            setBusy(false);
          }
        })
        .catch((error) => {
          if (!task.signal.aborted) {
            setData(null);
            setBusy(false);
            setPending(null);
            setStatus(
              error instanceof Error && ['denied', 'unavailable'].includes(error.message)
                ? error.message
                : 'failed',
            );
          }
        });
    },
    [subject, issuer],
  );
  useEffect(() => {
    function clear() {
      controller.current?.abort();
      setData(null);
      setPending(null);
      setNotice('');
      setBusy(false);
      setStatus('loading');
      form.current?.reset();
    }
    function visible() {
      if (document.hidden) clear();
      else load();
    }
    function show(event: PageTransitionEvent) {
      if (event.persisted) {
        clear();
        load();
      }
    }
    load();
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    let command = pending;
    if (!command)
      try {
        const fields = new FormData(event.currentTarget);
        const url = new URL(String(fields.get('invitation')).trim(), window.location.origin);
        if (
          url.origin !== window.location.origin ||
          url.pathname !== '/client' ||
          url.search ||
          !/^#[a-f0-9]{64}$/.test(url.hash) ||
          fields.get('acknowledged') !== 'on'
        )
          throw new Error(
            'Use the complete private client invitation for this site and confirm that you want to save it.',
          );
        command = { commandId: crypto.randomUUID(), token: url.hash.slice(1) };
        setPending(command);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'Check the invitation.');
        return;
      }
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    try {
      const value = await savedMissionRead(
        await fetch('/api/customer-saved-missions', {
          method: 'POST',
          signal: task.signal,
          headers: savedMissionHeaders({ subject, issuer }),
          body: JSON.stringify({ action: 'save', ...command, acknowledged: true }),
        }),
      );
      if (!item(value) || value.available !== true) throw new Error('failed');
      if (!task.signal.aborted) {
        setPending(null);
        form.current?.reset();
        setNotice('Invitation saved to this account. Its original access rules still apply.');
        setBusy(false);
        load();
      }
    } catch (error) {
      if (!task.signal.aborted) {
        if (error instanceof Error && error.message === 'denied') {
          setData(null);
          setPending(null);
          form.current?.reset();
          setStatus('denied');
        } else
          setNotice(
            'Saving could not be confirmed. Retry the same invitation or refresh your saved list before starting again.',
          );
      }
    } finally {
      inFlight.current = false;
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function remove(id: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    try {
      const response = await savedMissionRead(
        await fetch('/api/customer-saved-missions', {
          method: 'POST',
          signal: task.signal,
          headers: savedMissionHeaders({ subject, issuer }),
          body: JSON.stringify({
            action: 'remove',
            resourceId: id,
            commandId: crypto.randomUUID(),
          }),
        }),
      );
      const value = response as { id?: unknown; removed?: unknown };
      if (value?.id !== id || value.removed !== true) throw new Error('failed');
      if (!task.signal.aborted) {
        setNotice(
          'Removed from this account. The underlying invitation and commercial records were not cancelled.',
        );
        setBusy(false);
        load();
      }
    } catch (error) {
      if (!task.signal.aborted) {
        if (error instanceof Error && error.message === 'denied') {
          setData(null);
          setStatus('denied');
        } else
          setNotice(
            'Removal could not be confirmed. Refresh the list and retry if it is still saved.',
          );
      }
    } finally {
      inFlight.current = false;
      if (!task.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="detail-card" aria-label="Saved missions">
      <div className="ux-section-head">
        <h2>Saved missions</h2>
        {status !== 'loading' && status !== 'denied' && (
          <RefreshButton
            label="saved commercial missions"
            disabled={busy}
            onClick={() => {
              setData(null);
              setStatus('loading');
              load();
            }}
          />
        )}
      </div>
      <p>
        Keep approved private mission reports in this account across visits. Saving an invitation
        does not extend its expiry or grant access to other people or records.
      </p>
      {status === 'loading' && <p role="status">Loading your saved missions…</p>}
      {status === 'denied' && (
        <p role="alert">
          Your saved mission access could not be confirmed. Sign in again or ask the Corridra team
          about your account access.
        </p>
      )}
      {status === 'unavailable' && (
        <p role="status">
          Saved commercial mission access is unavailable. Your original private invitations remain
          separate.
        </p>
      )}
      {status === 'failed' && (
        <p role="alert">Your saved commercial missions could not be loaded. Try again.</p>
      )}
      {status === 'ready' && data?.missions.length === 0 && (
        <p className="ux-empty">No commercial mission invitations saved yet.</p>
      )}
      {status === 'ready' &&
        data?.missions.map((m) => (
          <article className="detail-card" key={m.id}>
            <h3>{m.available ? m.title : 'Saved invitation unavailable'}</h3>
            {m.available && m.expiresAt ? (
              <>
                <p>Original access expires {displayDate(m.expiresAt)}.</p>
                <a className="primary-link" href={'/account/missions/' + m.id}>
                  Open approved commercial report
                </a>
              </>
            ) : (
              <p>This invitation may have expired or been withdrawn. No report content is shown.</p>
            )}
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => void remove(m.id)}
            >
              Remove from my saved missions
            </button>
          </article>
        ))}
      {status === 'ready' && data?.nextAfter && (
        <button
          className="text-link"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            load(data.nextAfter!);
          }}
        >
          Load more commercial missions
        </button>
      )}
      {status === 'ready' && (
        <details className="ux-journey-disclosure">
          <summary>Save an invitation</summary>
          <form className="operator-form" ref={form} onSubmit={(event) => void save(event)}>
            <fieldset disabled={busy || !!pending}>
              <legend>Save an approved private invitation</legend>
              <label className="field">
                Private client mission invitation
                <input name="invitation" type="text" autoComplete="off" maxLength={300} required />
              </label>
              <label>
                <input name="acknowledged" type="checkbox" required /> Save this invitation to this
                account with its existing access restrictions.
              </label>
            </fieldset>
            <button className="primary-link" disabled={busy}>
              {pending ? 'Retry same invitation' : 'Save invitation to this account'}
            </button>
            {pending && (
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  form.current?.reset();
                  setNotice(
                    'Invitation cleared from this page. Refresh the saved list to check any earlier submission.',
                  );
                }}
              >
                Clear invitation from this page
              </button>
            )}
          </form>
        </details>
      )}
      {notice && <p role="status">{notice}</p>}
      <a className="text-link" href="/account#customer-missions">
        Open an original shared mission invitation
      </a>
    </section>
  );
}
