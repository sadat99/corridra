'use client';
import { ContributorSignout } from './signout';
import { displayMoney } from '@corridra/domain/locale';
import { formatDateTime } from '../../lib/ux/format';
import { countryName } from '../../lib/ux/options';

// D11: one date and time style. CQ-61: plain words for the task state and places, never raw codes.
const displayDate = (value: string) => formatDateTime(value);
const words = (code: string) => {
  const text = code.replaceAll('_', ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const place = (value: string) => (/^[A-Z]{2}$/.test(value) ? countryName(value) : value);
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
type Task = {
  id: string;
  version: number;
  status: string;
  deadline: string;
  expiresAt: string;
  reviewer: string;
  disclosure: {
    kind: string;
    market: string;
    workCountry: string;
    location: string;
    instructions: string;
    evidenceRequired: string;
    effort: string;
    dataHandling: string;
    cancellationTerms: string;
    disputeTerms: string;
  };
  reward: null | {
    currency: string;
    amountMinor: string;
    conditional: boolean;
    paymentGuaranteed: boolean;
  };
  history: {
    version: number;
    action: string;
    reason: string;
    createdAt: string;
    details: {
      body?: string;
      rationale?: string;
      evidenceQuality?: number;
      timeliness?: number;
      verificationId?: string;
    };
  }[];
  obligations:
    null | { id: string; amountMinor: string; currency: string; reverseOf: string | null }[];
};
type Command = {
  commandId: string;
  taskId: string;
  version: number;
  action: string;
  reason: string;
  details: { kind: string; body?: string };
};
export function TaskBoard({ workspace }: { workspace: string }) {
  return <ScopedTaskBoard key={workspace} workspace={workspace} />;
}
function ScopedTaskBoard({ workspace }: { workspace: string }) {
  const [tasks, setTasks] = useState<Task[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Command | null>(null);
  const [loaded, setLoaded] = useState(false),
    [readInterrupted, setReadInterrupted] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    const r = await fetch('/api/network/tasks?workspace=' + encodeURIComponent(workspace), {
      cache: 'no-store',
    });
    const body = await r.json();
    if (!r.ok) {
      if ([401, 403, 404, 410].includes(r.status)) {
        setTasks([]);
        setLoaded(false);
      }
      setReadInterrupted(true);
      throw new Error(body.error);
    }
    setTasks(body);
    setLoaded(true);
    setReadInterrupted(false);
  }, [workspace]);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    fetch('/api/network/tasks?workspace=' + encodeURIComponent(workspace), {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (live) {
          setTasks(data);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) setMessage(e.message);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [workspace]);
  async function send(command: Command) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(command);
    setBusy(true);
    setMessage('');
    try {
      if (!navigator.onLine)
        throw new Error(
          'Not received: you are offline. Keep this page open and retry when connected.',
        );
      const r = await fetch('/api/network/tasks?workspace=' + encodeURIComponent(workspace), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      const body = await r.json();
      if (!r.ok) {
        if ([401, 403, 404, 410].includes(r.status)) {
          setTasks([]);
          setLoaded(false);
        }
        throw new Error(body.error);
      }
      setPending(null);
      setMessage('Received and saved.');
      await refresh().catch((e) => {
        setReadInterrupted(true);
        setMessage('Received and saved. The task list could not refresh: ' + e.message);
      });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Not received. Retry this submission.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>, task: Task, action: string) {
    e.preventDefault();
    if (pending || inFlight.current || readInterrupted) return;
    const f = new FormData(e.currentTarget);
    void send({
      commandId: crypto.randomUUID(),
      taskId: task.id,
      version: task.version,
      action,
      reason: String(f.get('reason')),
      details:
        action === 'SUBMIT'
          ? { kind: 'submission', body: String(f.get('body')) }
          : { kind: 'decision' },
    });
  }
  return (
    <section aria-label="Assigned tasks">
      <p role="status" aria-live="polite">
        {message}
      </p>
      <button
        className="text-link"
        disabled={busy}
        onClick={() => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          void refresh()
            .catch((e) => setMessage(e.message))
            .finally(() => {
              inFlight.current = false;
              setBusy(false);
            });
        }}
      >
        Refresh tasks
      </button>
      {pending && (
        <button className="text-link" disabled={busy} onClick={() => void send(pending)}>
          Retry the same request
        </button>
      )}
      {pending && (
        <button
          className="text-link"
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                'Clear local retry data? This does not cancel a request already received. Refresh tasks to check its status.',
              )
            )
              return;
            setPending(null);
            setMessage(
              'Local retry data cleared. This does not cancel work already received. Refresh tasks to check its status.',
            );
          }}
        >
          Clear pending request
        </button>
      )}
      <ContributorSignout disabled={busy || !!pending} />
      {pending && <p>Retry the pending request or clear it before signing out.</p>}
      {!loaded && (
        <p>
          {message
            ? 'Assigned work could not be loaded. Refresh tasks or verify your authenticator again.'
            : 'Loading assigned work…'}
        </p>
      )}
      {readInterrupted && (
        <p>
          Task progress could not be refreshed. Refresh tasks before starting another command.
          Existing form entries remain here.
        </p>
      )}
      {loaded && !tasks.length && (
        <p role="status">
          <strong>You’re set up. No tasks assigned yet.</strong> When the Corridra team assigns you
          a task, it appears here.
        </p>
      )}
      {tasks.map((task) => (
        <article className="detail-card ux-task-card" key={task.id}>
          <p className="label">EXACT ASSIGNMENT · VERSION {task.version}</p>
          <h2>{words(task.disclosure.kind)}</h2>
          <p>
            {words(task.status)} · {place(task.disclosure.market)} · work country{' '}
            {place(task.disclosure.workCountry)}
          </p>
          <p>{task.disclosure.instructions}</p>
          <dl>
            <dt>Location</dt>
            <dd>{task.disclosure.location}</dd>
            <dt>Deadline</dt>
            <dd>{displayDate(task.deadline)}</dd>
            <dt>Late submission cutoff</dt>
            <dd>{displayDate(task.expiresAt)}</dd>
            <dt>Evidence required</dt>
            <dd>{task.disclosure.evidenceRequired}</dd>
            <dt>Expected effort</dt>
            <dd>{task.disclosure.effort}</dd>
            <dt>Data handling</dt>
            <dd>{task.disclosure.dataHandling}</dd>
            <dt>Reviewer</dt>
            <dd>{task.reviewer}</dd>
            <dt>Cancellation</dt>
            <dd>{task.disclosure.cancellationTerms}</dd>
            <dt>Disputes</dt>
            <dd>{task.disclosure.disputeTerms}</dd>
            <dt>Reward rule</dt>
            <dd>
              {task.reward
                ? `${displayMoney(task.reward.amountMinor, task.reward.currency)}, conditional on reviewed work and independent approval`
                : 'No monetary reward is offered for this task.'}
            </dd>
          </dl>
          <p>
            Task completion does not guarantee earnings or payment. Late submissions require
            reviewer assessment.
          </p>
          {task.status === 'ASSIGN' && (
            <form className="operator-form" onSubmit={(e) => submit(e, task, 'ACCEPT')}>
              <fieldset disabled={busy || !!pending || readInterrupted}>
                <legend className="sr-only">Acceptance</legend>
                <label className="field">
                  Acceptance and relationship confirmation
                  <input name="reason" required minLength={3} maxLength={500} />
                </label>
                <button className="primary-link" disabled={busy || !!pending || readInterrupted}>
                  Accept the disclosed task
                </button>
              </fieldset>
            </form>
          )}
          {['ACCEPT', 'REQUEST_CORRECTION'].includes(task.status) && (
            <form className="operator-form" onSubmit={(e) => submit(e, task, 'SUBMIT')}>
              <fieldset disabled={busy || !!pending || readInterrupted}>
                <legend className="sr-only">Original submission</legend>
                <label className="field">
                  Original work and evidence statement
                  <textarea name="body" required minLength={3} maxLength={2000} />
                </label>
                <label className="field">
                  Submission context
                  <input name="reason" required minLength={3} maxLength={500} />
                </label>
                <button className="primary-link" disabled={busy || !!pending || readInterrupted}>
                  Submit for evidence review
                </button>
              </fieldset>
            </form>
          )}
          {['SUBMIT', 'REVIEW', 'COMPLETE', 'REJECT'].includes(task.status) && (
            <form className="operator-form" onSubmit={(e) => submit(e, task, 'DISPUTE')}>
              <fieldset disabled={busy || !!pending || readInterrupted}>
                <legend className="sr-only">Dispute request</legend>
                <label className="field">
                  Dispute reason
                  <textarea name="reason" required minLength={3} maxLength={500} />
                </label>
                <button className="text-link" disabled={busy || !!pending || readInterrupted}>
                  Request dispute review
                </button>
              </fieldset>
            </form>
          )}
          <details>
            <summary>Work and review history</summary>
            <ol>
              {task.history?.map((h) => (
                <li key={h.version}>
                  <p>
                    Version {h.version} · {h.action}: {h.reason}
                    <br />
                    {displayDate(h.createdAt)}
                  </p>
                  {h.details.body && <p>{h.details.body}</p>}
                  {h.details.rationale && (
                    <p>
                      Evidence quality {h.details.evidenceQuality}/4; timeliness{' '}
                      {h.details.timeliness}/4. {h.details.rationale}{' '}
                      {h.details.verificationId
                        ? 'Linked independently verified evidence'
                        : 'Source-reported work; no independent verification'}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </details>
          {!!task.obligations?.length && (
            <div>
              <h3>Reviewed reward obligations</h3>
              <ul>
                {task.obligations.map((o) => (
                  <li key={o.id}>
                    {displayMoney(o.amountMinor, o.currency)}
                    {o.reverseOf ? ' compensating reversal' : ' obligation'}, payment not guaranteed
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
