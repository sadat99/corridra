'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { displayDate } from '@corridra/domain/locale';
const options = z.object({
  publicationId: z.uuid(),
  synthetic: z.literal(true),
  nextVersion: z.number().int().positive(),
  decisions: z
    .array(
      z.object({
        id: z.uuid(),
        target_id: z.uuid(),
        decision: z.enum(['SELECT', 'DECLINE', 'NEED_INFORMATION']),
        rationale: z.string(),
        next_action: z.string(),
        due_at: z.string(),
        quotation_id: z.uuid().nullable(),
        source_kind: z.string(),
        claim_status: z.string(),
      }),
    )
    .max(100),
  approvals: z
    .array(
      z.object({
        id: z.uuid(),
        version: z.number().int().positive(),
        decision_ids: z.array(z.uuid()),
        reason: z.string(),
        created_at: z.string(),
      }),
    )
    .max(25),
});
type Props = {
  tenant: string;
  publications: { id: string; copy: { title: string }; revoked: boolean }[];
};
type Approval = {
  commandId: string;
  publicationId: string;
  version: number;
  decisionIds: string[];
  reason: string;
  approved: true;
};
export function DecisionDisclosures(props: Props) {
  return <PrivateDisclosures key={props.tenant} {...props} />;
}
function PrivateDisclosures({ tenant, publications }: Props) {
  const [publication, setPublication] = useState(''),
    [data, setData] = useState<z.infer<typeof options> | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Approval | null>(null);
  const controller = useRef<AbortController | null>(null);
  const endpoint =
    '/api/workspace/customer-decision-disclosures?tenant=' + encodeURIComponent(tenant);
  useEffect(() => {
    const clear = () => {
      controller.current?.abort();
      setData(null);
      setPending(null);
      setBusy(false);
      setMessage('Private review cleared. Reload to check current authority.');
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') clear();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', clear);
    return () => {
      controller.current?.abort();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', clear);
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => {
      setData(null);
      setPending(null);
      setMessage('Review expired. Reload current decisions before approving.');
    }, 60000);
    return () => clearTimeout(timer);
  }, [data]);
  async function load(id = publication) {
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setData(null);
    setPending(null);
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(endpoint + '&publicationId=' + encodeURIComponent(id), {
        cache: 'no-store',
        signal: task.signal,
      });
      if (!r.ok)
        throw Error(
          r.status === 503
            ? 'Reviewed decision disclosure is unavailable.'
            : r.status === 401 || r.status === 403
              ? 'Owner/admin access and fresh authentication are required.'
              : 'Decision review could not be loaded.',
        );
      const v = options.parse(await r.json());
      if (v.publicationId !== id) throw Error('Decision review changed. Reload.');
      if (!task.signal.aborted) setData(v);
    } catch (e) {
      if (!task.signal.aborted)
        setMessage(e instanceof Error ? e.message : 'Decision review failed.');
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function approve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !data) return;
    const form = new FormData(e.currentTarget);
    const value: Approval = pending ?? {
      commandId: crypto.randomUUID(),
      publicationId: publication,
      version: data.nextVersion,
      decisionIds: form.getAll('decisionId').map(String),
      reason: String(form.get('reason') ?? '').trim(),
      approved: true,
    };
    setPending(value);
    setBusy(true);
    setMessage('');
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        signal: task.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!r.ok)
        throw Error(
          [401, 403].includes(r.status)
            ? 'Approval denied. Verify your authenticator, then reload.'
            : r.status === 409
              ? 'Review conflicts with an existing command. Reload current revisions.'
              : 'Approval was not confirmed. Retry the same command or reload its recorded status.',
        );
      const receipt = z
        .object({ id: z.uuid(), version: z.number().int().positive() })
        .parse(await r.json());
      if (receipt.id !== value.commandId || receipt.version !== value.version)
        throw Error('Approval receipt did not match. Reload recorded status.');
      if (!task.signal.aborted) {
        setPending(null);
        setData(null);
        setMessage(
          'Disclosure revision ' +
            receipt.version +
            ' recorded. Reload to inspect current decisions.',
        );
      }
    } catch (e) {
      if (!task.signal.aborted)
        setMessage(e instanceof Error ? e.message : 'Approval was not confirmed.');
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  return (
    <details className="ux-mission-detail" style={{ overflowWrap: 'anywhere' }}>
      <summary>Approve commercial decision disclosure</summary>
      <p>
        Explicitly share original V2 decisions in your reviewed client report. Selection is separate
        from an order, contract or payment. Owner/admin access and fresh MFA are required. Synthetic
        capability; real operation remains closed.
      </p>
      <label>
        Reviewed publication
        <select
          value={publication}
          disabled={busy}
          onChange={(e) => {
            controller.current?.abort();
            setPublication(e.target.value);
            setData(null);
            setPending(null);
            setMessage('');
          }}
        >
          <option value="">Choose your existing publication</option>
          {publications
            .filter((p) => !p.revoked)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.copy.title}
              </option>
            ))}
        </select>
      </label>
      <button type="button" disabled={!publication || busy} onClick={() => void load()}>
        Load decision review
      </button>
      {message && <p role="status">{message}</p>}
      {data && (
        <form onSubmit={approve}>
          <p>
            Next revision {data.nextVersion}. Only checked records will be disclosed. An empty
            revision withdraws the decision list while preserving history.
          </p>
          <fieldset disabled={busy || !!pending}>
            <legend>Original decisions and fields to disclose</legend>
            {!data.decisions.length && (
              <p>
                No eligible decisions exist for the approved requirement, targets and quotations.
              </p>
            )}
            {data.decisions.map((d) => (
              <label className="check-field" key={d.id}>
                <input type="checkbox" name="decisionId" value={d.id} />
                <span>
                  <strong>{d.decision}</strong> · target {d.target_id}
                  <br />
                  {d.rationale}
                  <br />
                  Next action: {d.next_action} · due {displayDate(d.due_at)}
                  <br />
                  {d.source_kind} · {d.claim_status}
                  {d.quotation_id && <> · quotation {d.quotation_id}</>}
                </span>
              </label>
            ))}
            <label>
              Reason for this disclosure revision
              <textarea name="reason" required minLength={3} maxLength={500} />
            </label>
            <label className="check-field">
              <input type="checkbox" required />I reviewed every selected rationale, next action,
              due date and source status for this client report. No private owner, contact or source
              location is shared.
            </label>
          </fieldset>
          <button disabled={busy} type="submit">
            {pending ? 'Retry the same approval' : 'Approve disclosure revision'}
          </button>
          <details>
            <summary>Previous disclosure revisions</summary>
            {data.approvals.length ? (
              data.approvals.map((a) => (
                <p key={a.id}>
                  Version {a.version} · {a.decision_ids.length} records · {a.reason} ·{' '}
                  {displayDate(a.created_at)}
                </p>
              ))
            ) : (
              <p>No approved decision disclosure yet.</p>
            )}
          </details>
        </form>
      )}
    </details>
  );
}
