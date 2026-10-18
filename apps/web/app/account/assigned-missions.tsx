'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { displayDate } from '@corridra/domain/locale';
import { savedMissionHeaders, savedMissionRead, type SavedMissionScope } from './saved-missions';
const unavailable = z
  .object({ id: z.uuid(), requestId: z.uuid(), available: z.literal(false) })
  .strict();
const available = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    available: z.literal(true),
    title: z.string().max(2000),
    expiresAt: z.iso.datetime({ offset: true }),
    savedResourceId: z.uuid().nullable(),
  })
  .strict();
const pageSchema = z
  .object({
    assignments: z.array(z.discriminatedUnion('available', [unavailable, available])).max(25),
    nextAfter: z.uuid().nullable(),
    synthetic: z.literal(true),
  })
  .strict();
type Page = z.infer<typeof pageSchema> & { displayUntil: number };
type Pending = { commandId: string; assignmentId: string; acknowledged: true };
export function AssignedMissions(props: SavedMissionScope) {
  return <PrivateAssignments key={JSON.stringify([props.issuer, props.subject])} {...props} />;
}
function PrivateAssignments({ subject, issuer }: SavedMissionScope) {
  const router = useRouter();
  const [data, setData] = useState<Page | null>(null),
    [status, setStatus] = useState('loading'),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState<Pending | null>(null);
  const controller = useRef<AbortController | null>(null);
  const clear = useCallback(() => {
    controller.current?.abort();
    setData(null);
    setPending(null);
    setBusy(false);
    setNotice('');
    setStatus('refresh');
  }, []);
  const read = useCallback(
    async (signal: AbortSignal, after?: string) => {
      const value = await fetch(
        '/api/customer-assigned-missions' + (after ? '?after=' + encodeURIComponent(after) : ''),
        { cache: 'no-store', signal, headers: savedMissionHeaders({ subject, issuer }) },
      ).then(savedMissionRead);
      const page = pageSchema.parse(value);
      if (
        page.nextAfter === after ||
        new Set(page.assignments.map((v) => v.id)).size !== page.assignments.length ||
        page.assignments.some((v) => v.available && Date.parse(v.expiresAt) <= Date.now())
      )
        throw Error('failed');
      return {
        ...page,
        displayUntil: Math.min(
          Date.now() + 60000,
          ...page.assignments.filter((v) => v.available).map((v) => Date.parse(v.expiresAt)),
        ),
      };
    },
    [subject, issuer],
  );
  const failure = useCallback((error: unknown) => {
    setData(null);
    setBusy(false);
    setStatus(
      error instanceof Error && ['denied', 'unavailable'].includes(error.message)
        ? error.message
        : 'failed',
    );
  }, []);
  useEffect(() => {
    const task = new AbortController();
    controller.current = task;
    void read(task.signal)
      .then((v) => {
        if (!task.signal.aborted) {
          setData(v);
          setStatus('ready');
        }
      })
      .catch((e) => {
        if (!task.signal.aborted) failure(e);
      });
    const hide = () => {
      if (document.visibilityState === 'hidden') clear();
    };
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) clear();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', restore);
    return () => {
      controller.current?.abort();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
    };
  }, [read, failure, clear]);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(clear, Math.max(0, data.displayUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [data, clear]);
  function load(after?: string) {
    if (busy) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setNotice('');
    setPending(null);
    if (!after) {
      setData(null);
      setStatus('loading');
    }
    void read(task.signal, after)
      .then((v) => {
        if (!task.signal.aborted) {
          setData((old) => ({
            ...v,
            assignments: after ? [...(old?.assignments ?? []), ...v.assignments] : v.assignments,
            displayUntil: after
              ? Math.min(old?.displayUntil ?? v.displayUntil, v.displayUntil)
              : v.displayUntil,
          }));
          setStatus('ready');
          setBusy(false);
        }
      })
      .catch((e) => {
        if (!task.signal.aborted) failure(e);
      });
  }
  async function accept(value: Pending) {
    if (busy) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setPending(value);
    setBusy(true);
    setNotice('');
    try {
      const raw = await fetch('/api/customer-assigned-missions', {
        method: 'POST',
        cache: 'no-store',
        signal: task.signal,
        headers: savedMissionHeaders({ subject, issuer }),
        body: JSON.stringify(value),
      }).then(savedMissionRead);
      const receipt = z
        .object({
          id: z.uuid(),
          available: z.boolean(),
          removed: z.boolean(),
          title: z.string().optional(),
          expiresAt: z.string().optional(),
        })
        .strict()
        .parse(raw);
      if (!receipt.available || receipt.removed) throw Error('denied');
      if (!task.signal.aborted) router.push('/account/missions/' + receipt.id);
    } catch (e) {
      if (!task.signal.aborted) {
        failure(e);
        if (e instanceof Error && e.message === 'denied') setPending(null);
        else
          setNotice(
            'Saving was not confirmed. Retry the same command or refresh current deliveries.',
          );
      }
    }
  }
  function submit(e: FormEvent<HTMLFormElement>, assignmentId: string) {
    e.preventDefault();
    void accept({ commandId: crypto.randomUUID(), assignmentId, acknowledged: true });
  }
  return (
    <section
      className="ux-mission-detail"
      aria-label="Commercial work delivered to your account"
      style={{ overflowWrap: 'anywhere' }}
    >
      <h2>Commercial work delivered to your account</h2>
      <p>
        Reviewed reports for requests you created appear here. No private invitation link is needed.
        These synthetic reports do not confirm a meeting, order or payment.
      </p>
      {!data && (
        <p role="status">
          {status === 'loading'
            ? 'Checking your approved deliveries…'
            : status === 'denied'
              ? 'This account cannot open these deliveries. Return to your account and check access.'
              : status === 'unavailable'
                ? 'Account mission delivery is unavailable.'
                : status === 'refresh'
                  ? 'Private delivery details cleared. Refresh to check current access.'
                  : 'Deliveries could not be checked. Try again.'}
        </p>
      )}
      <button className="text-link" type="button" onClick={() => load()} disabled={busy}>
        Refresh delivered missions
      </button>
      {status === 'denied' && (
        <a href="/account" className="text-link">
          Return to your account
        </a>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && !busy && status !== 'denied' && (
        <button className="primary-link" type="button" onClick={() => void accept(pending)}>
          Retry saving the same report
        </button>
      )}
      {data && (
        <>
          {!data.assignments.length && (
            <p>
              No commercial report has been delivered to this account yet. Your existing requests
              remain available in My Work.
            </p>
          )}
          {data.assignments.map((item) => (
            <article className="delivery-card" key={item.id}>
              {item.available ? (
                <>
                  <h3>{item.title}</h3>
                  <p>Current report access expires {displayDate(item.expiresAt)}.</p>
                  {item.savedResourceId ? (
                    <a className="primary-link" href={'/account/missions/' + item.savedResourceId}>
                      Open approved commercial mission
                    </a>
                  ) : (
                    <form onSubmit={(e) => submit(e, item.id)}>
                      <label className="check-field">
                        <input type="checkbox" required disabled={busy} />I understand this saves a
                        private shortcut to the approved synthetic report. It grants no access to
                        colleagues.
                      </label>
                      <button className="primary-link" disabled={busy} type="submit">
                        Save and open approved report
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <p>
                  This delivery is unavailable. Previously saved reports have their own access
                  controls.
                </p>
              )}
            </article>
          ))}
          {data.nextAfter && (
            <button
              className="text-link"
              type="button"
              disabled={busy}
              onClick={() => load(data.nextAfter!)}
            >
              Load more delivered missions
            </button>
          )}
        </>
      )}
    </section>
  );
}
