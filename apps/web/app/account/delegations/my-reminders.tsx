'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Reminders } from '@corridra/auth/customer-programme-terms';
import { failureText, parseReminders, termsApi, TermsError } from './terms-client';

type Props = { subject: string; issuer: string };
type Phase = 'loading' | 'ready' | 'denied' | 'unavailable' | 'failed';

// In-app reminders for the signed-in person. Nothing is sent by email, text or push.
export function MyReminders(props: Props) {
  return <ScopedReminders key={props.issuer + ':' + props.subject} {...props} />;
}

function ScopedReminders({ subject, issuer }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<Reminders | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const writing = useRef(false);
  const api = useRef(termsApi(subject, issuer));

  const lose = useCallback((to: Phase) => {
    if (timer.current) clearTimeout(timer.current);
    setData(null);
    setPhase(to);
  }, []);
  const load = useCallback(async () => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    try {
      const body = parseReminders(await api.current.get({ view: 'reminders' }, controller.signal));
      if (controller.signal.aborted || !active.current) return;
      setData(body);
      setPhase('ready');
      if (timer.current) clearTimeout(timer.current);
      const wait = Date.parse(body.expiresAt) - Date.now();
      timer.current = setTimeout(() => lose('failed'), Math.max(wait, 1000));
    } catch (e) {
      if (controller.signal.aborted || !active.current) return;
      if (e instanceof TermsError && e.kind === 'denied') lose('denied');
      else if (e instanceof TermsError && e.kind === 'unavailable') lose('unavailable');
      else lose('failed');
    }
  }, [lose]);
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
      task.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  async function finish(t: Reminders['assignedToYou'][number]) {
    if (writing.current) return;
    const input = {
      workspaceId: t.workspaceId,
      programmeId: t.programmeId,
      taskId: t.taskId,
      expectedVersion: t.version,
    };
    const signature = JSON.stringify(input);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await api.current.post('done', { commandId: intent.current.commandId, ...input });
      intent.current = null;
      setNotice('Marked done: ' + t.title);
      await load();
    } catch (e) {
      if (e instanceof TermsError && e.kind === 'denied') lose('denied');
      else
        setError(
          e instanceof TermsError && e.kind === 'conflict'
            ? 'This task changed or is no longer yours. Reload to see the latest.'
            : failureText(e),
        );
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  const total = data
    ? data.assignedToYou.length + data.forParticipant.length + data.termsToAccept.length
    : 0;
  return (
    <section
      className="detail-card"
      aria-label="Your reminders"
      aria-busy={phase === 'loading' || busy}
    >
      <h2>Your reminders</h2>
      <p>
        Tasks due in the next three days or already late. They appear here only; no email, text or
        push message is sent.
      </p>
      {phase === 'loading' && <p role="status">Checking what is due…</p>}
      {phase === 'unavailable' && <p role="status">Reminders are unavailable right now.</p>}
      {phase === 'denied' && (
        <p role="alert">Your access changed. Private details were cleared. Reload your account.</p>
      )}
      {phase === 'failed' && (
        <>
          <p role="alert">Reminders could not be loaded.</p>
          <button type="button" className="text-link" onClick={() => void load()}>
            Reload reminders
          </button>
        </>
      )}
      {phase === 'ready' && data && (
        <>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          {total === 0 && <p>Nothing is due soon. You are up to date as of {data.asOf}.</p>}
          {data.assignedToYou.length > 0 && (
            <>
              <h3>Tasks given to you</h3>
              <ul>
                {data.assignedToYou.map((t) => (
                  <li key={t.taskId}>
                    <strong>{t.title}</strong> · {t.programmeName} · due {t.dueOn} ·{' '}
                    <span
                      className="ux-status"
                      data-tone={t.state === 'OVERDUE' ? 'critical' : 'caution'}
                    >
                      {t.state === 'OVERDUE' ? 'Overdue' : 'Due soon'}
                    </span>{' '}
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => void finish(t)}
                    >
                      Mark done: {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.forParticipant.length > 0 && (
            <>
              <h3>Programme tasks to be aware of</h3>
              <ul>
                {data.forParticipant.map((t, i) => (
                  <li key={i}>
                    <strong>{t.title}</strong> · {t.programmeName} · due {t.dueOn} ·{' '}
                    <span
                      className="ux-status"
                      data-tone={t.state === 'OVERDUE' ? 'critical' : 'caution'}
                    >
                      {t.state === 'OVERDUE' ? 'Overdue' : 'Due soon'}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {data.termsToAccept.length > 0 && (
            <>
              <h3>Terms to accept again</h3>
              <ul>
                {data.termsToAccept.map((t) => (
                  <li key={t.registrationId}>
                    {t.programmeName} has new terms (version {t.version}). Open the programme below
                    to read and accept them.
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="text-link" disabled={busy} onClick={() => void load()}>
            Reload reminders
          </button>
        </>
      )}
    </section>
  );
}
