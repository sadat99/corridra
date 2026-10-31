'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { displayDate } from '@corridra/domain/locale';
const schema = z
  .object({
    missionId: z.uuid(),
    synthetic: z.literal(true),
    request: z.object({ id: z.uuid(), createdAt: z.iso.datetime({ offset: true }) }).nullable(),
    links: z
      .array(
        z.object({
          id: z.uuid(),
          title: z.string(),
          expiresAt: z.iso.datetime({ offset: true }),
          assignmentId: z.uuid().nullable(),
        }),
      )
      .max(1000),
  })
  .strict();
type Props = { tenant: string; mission: string };
type Pending = {
  commandId: string;
  requestId: string;
  linkId: string;
  reason: string;
  approved: true;
};
export function CustomerMissionDelivery(props: Props) {
  return <PrivateDelivery key={JSON.stringify([props.tenant, props.mission])} {...props} />;
}
function PrivateDelivery({ tenant, mission }: Props) {
  const [data, setData] = useState<z.infer<typeof schema> | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Pending | null>(null);
  const controller = useRef<AbortController | null>(null);
  const endpoint = '/api/workspace/customer-mission-delivery?tenant=' + encodeURIComponent(tenant);
  useEffect(() => {
    const clear = () => {
      controller.current?.abort();
      setData(null);
      setBusy(false);
      setPending(null);
      setMessage('Private delivery review cleared. Reload current scope.');
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
      controller.current?.abort();
      setData(null);
      setBusy(false);
      setPending(null);
      setMessage('Review expired. Reload before approving account delivery.');
    }, 60000);
    return () => clearTimeout(timer);
  }, [data]);
  async function load() {
    if (busy) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setData(null);
    setPending(null);
    setMessage('');
    try {
      const r = await fetch(endpoint + '&mission=' + encodeURIComponent(mission), {
        cache: 'no-store',
        signal: task.signal,
      });
      if (!r.ok)
        throw Error(
          r.status === 503
            ? 'Account delivery review is unavailable.'
            : r.status === 401 || r.status === 403
              ? 'Owner/admin access is required for this mission.'
              : 'Delivery review could not be loaded.',
        );
      const v = schema.parse(await r.json());
      if (v.missionId !== mission) throw Error('Mission review changed. Reload.');
      if (!task.signal.aborted) setData(v);
    } catch (e) {
      if (!task.signal.aborted)
        setMessage(e instanceof Error ? e.message : 'Delivery review failed.');
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function approve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !data?.request) return;
    const form = new FormData(e.currentTarget),
      value: Pending = pending ?? {
        commandId: crypto.randomUUID(),
        requestId: data.request.id,
        linkId: String(form.get('linkId') ?? ''),
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
          r.status === 401 || r.status === 403
            ? 'Approval denied. Verify your authenticator and reload.'
            : r.status === 409
              ? 'Delivery conflicts with a recorded command. Reload assignments.'
              : 'Delivery was not confirmed. Retry the same command or reload recorded scope.',
        );
      const receipt = z
        .object({ id: z.uuid() })
        .strict()
        .parse(await r.json());
      if (receipt.id !== value.commandId)
        throw Error('Delivery receipt did not match. Reload recorded scope.');
      if (!task.signal.aborted) {
        setData(null);
        setPending(null);
        setMessage(
          'Reviewed report delivered to the original request creator account. No message or email was sent.',
        );
      }
    } catch (e) {
      if (!task.signal.aborted)
        setMessage(e instanceof Error ? e.message : 'Delivery was not confirmed.');
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  return (
    <details className="ux-mission-detail" style={{ overflowWrap: 'anywhere' }} data-madeup-panel>
      <summary>Deliver a reviewed mission to the customer account</summary>
      <p>
        Approve your existing client report for the person who created the original request.
        Workspace colleagues and organisers get no private access. This works in sample workspaces
        only (madeup records) and needs owner or admin access and a fresh authenticator check.
        Delivery to real customer accounts stays closed.
      </p>
      <button className="text-link" type="button" disabled={busy} onClick={() => void load()}>
        Load account delivery review
      </button>
      {message && <p role="status">{message}</p>}
      {data && !data.request && (
        <p>
          This mission has no customer-owned request. Account delivery is unavailable;existing
          controlled sharing remains accessible.
        </p>
      )}
      {data?.request && (
        <>
          <p>
            Original private request received {displayDate(data.request.createdAt)}. Only reviewed
            client links on this exact mission are eligible.
          </p>
          {!data.links.length && (
            <p>
              Create a reviewed client publication and client report link using the existing sharing
              controls.
            </p>
          )}
          {data.links.some((l) => l.assignmentId === null) && (
            <form onSubmit={approve}>
              <fieldset disabled={busy || !!pending}>
                <legend>Reviewed client report to deliver</legend>
                {data.links
                  .filter((l) => l.assignmentId === null)
                  .map((l) => (
                    <label className="check-field" key={l.id}>
                      <input type="radio" name="linkId" value={l.id} required />
                      <span>
                        {l.title} · expires {displayDate(l.expiresAt)}
                      </span>
                    </label>
                  ))}
                <label>
                  Reason for account delivery
                  <textarea name="reason" minLength={3} maxLength={500} required />
                </label>
                <label className="check-field">
                  <input type="checkbox" required />I reviewed the report scope for its original
                  requester. This grants no access to colleagues and sends no communication.
                </label>
              </fieldset>
              <button className="primary-link" type="submit" disabled={busy}>
                {pending ? 'Retry the same delivery approval' : 'Approve account delivery'}
              </button>
            </form>
          )}
          {data.links
            .filter((l) => l.assignmentId !== null)
            .map((l) => (
              <p key={l.id}>
                {l.title} · already delivered;original expiry and revocation remain binding.
              </p>
            ))}
        </>
      )}
    </details>
  );
}
