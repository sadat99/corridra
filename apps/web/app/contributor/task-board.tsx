'use client';
import { ContributorSignout } from './signout';
import { displayMoney } from '@corridra/domain/locale';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
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
  const [tasks, setTasks] = useState<Task[]>([]),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Command | null>(null);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const r = await fetch('/api/network/tasks?workspace=' + encodeURIComponent(workspace), {
      cache: 'no-store',
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    setTasks(body);
    setLoaded(true);
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
      if (!r.ok) throw new Error(body.error);
      setPending(null);
      await refresh();
      setMessage('Received and saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Not received. Retry this submission.');
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>, task: Task, action: string) {
    e.preventDefault();
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
        onClick={() => void refresh().catch((e) => setMessage(e.message))}
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
      {loaded && !tasks.length && <p>No current reviewed assignment is available.</p>}
      {tasks.map((task) => (
        <article className="detail-card" key={task.id}>
          <h2>{task.disclosure.kind.replaceAll('_', ' ')}</h2>
          <p>
            {task.status.replaceAll('_', ' ')} · {task.disclosure.market} · work country{' '}
            {task.disclosure.workCountry}
          </p>
          <p>{task.disclosure.instructions}</p>
          <dl>
            <dt>Location</dt>
            <dd>{task.disclosure.location}</dd>
            <dt>Deadline</dt>
            <dd>{new Date(task.deadline).toLocaleString()}</dd>
            <dt>Late submission cutoff</dt>
            <dd>{new Date(task.expiresAt).toLocaleString()}</dd>
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
              <label className="field">
                Acceptance and relationship confirmation
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="primary-link" disabled={busy || !!pending}>
                Accept the disclosed task
              </button>
            </form>
          )}
          {['ACCEPT', 'REQUEST_CORRECTION'].includes(task.status) && (
            <form className="operator-form" onSubmit={(e) => submit(e, task, 'SUBMIT')}>
              <label className="field">
                Original work and evidence statement
                <textarea name="body" required minLength={3} maxLength={2000} />
              </label>
              <label className="field">
                Submission context
                <input name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="primary-link" disabled={busy || !!pending}>
                Submit for evidence review
              </button>
            </form>
          )}
          {['SUBMIT', 'REVIEW', 'COMPLETE', 'REJECT'].includes(task.status) && (
            <form className="operator-form" onSubmit={(e) => submit(e, task, 'DISPUTE')}>
              <label className="field">
                Dispute reason
                <textarea name="reason" required minLength={3} maxLength={500} />
              </label>
              <button className="text-link" disabled={busy || !!pending}>
                Request dispute review
              </button>
            </form>
          )}
          <details>
            <summary>Work and review history</summary>
            <ol>
              {task.history?.map((h) => (
                <li key={h.version}>
                  <p>
                    {h.action}: {h.reason}
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
          {task.obligations?.length && (
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
