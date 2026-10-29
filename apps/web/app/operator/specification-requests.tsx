'use client';
import { useEffect, useRef, useState } from 'react';
import {
  specificationOptions,
  type specificationRequestInput,
} from '@corridra/domain/specification-confirmation';
import type { z } from 'zod';
import { SpecificationFields } from '../../components/specification-fields';
type Props = {
  tenant: string;
  publications: { id: string; copy: { title: string }; revoked: boolean }[];
  owners: { user_id: string; name: string }[];
};
export function SpecificationRequests(props: Props) {
  return <PrivateRequests key={props.tenant} {...props} />;
}
function PrivateRequests({ tenant, publications, owners }: Props) {
  const [publication, setPublication] = useState(''),
    [data, setData] = useState<z.infer<typeof specificationOptions> | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<z.infer<typeof specificationRequestInput> | null>(null);
  const controller = useRef<AbortController | null>(null),
    inFlight = useRef(false);
  const endpoint =
    '/api/workspace/specification-confirmations?tenant=' + encodeURIComponent(tenant);
  useEffect(() => {
    const clear = () => {
      controller.current?.abort();
      setData(null);
      setPending(null);
      setBusy(false);
    };
    const hide = () => {
      if (document.hidden) clear();
    };
    window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', hide);
    return () => {
      controller.current?.abort();
      window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', hide);
    };
  }, []);
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => {
      setData(null);
      setPending(null);
      setMessage('Review expired. Reload current requirements before requesting confirmation.');
    }, 60000);
    return () => clearTimeout(timer);
  }, [data]);
  async function load() {
    if (inFlight.current) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setData(null);
    setPending(null);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(endpoint + '&publicationId=' + encodeURIComponent(publication), {
        cache: 'no-store',
        signal: task.signal,
      });
      if (!response.ok) throw new Error(response.status === 503 ? 'unavailable' : 'denied');
      const value = specificationOptions.parse(await response.json());
      if (value.publicationId !== publication) throw Error('denied');
      if (!task.signal.aborted) setData(value);
    } catch (error) {
      if (!task.signal.aborted)
        setMessage(
          error instanceof Error && error.message === 'unavailable'
            ? 'Specification confirmation is not available yet. Ask the workspace owner to check access.'
            : 'Current publication access could not be checked. Reload and verify your authenticator.',
        );
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  async function send(form: HTMLFormElement) {
    if (inFlight.current || !data?.requirement) return;
    const fields = new FormData(form);
    const command = pending ?? {
      commandId: crypto.randomUUID(),
      publicationId: data.publicationId,
      requirementId: data.requirement.requirementId,
      requirementVersion: data.requirement.requirementVersion,
      requirementDigest: data.requirement.requirementDigest,
      ownerId: String(fields.get('ownerId')),
      dueAt: new Date(String(fields.get('dueAt')) + 'Z').toISOString(),
      approved: true as const,
    };
    inFlight.current = true;
    setPending(command);
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      if (!response.ok)
        throw new Error([401, 403, 409, 422].includes(response.status) ? 'denied' : 'failed');
      const receipt = await response.json();
      if (receipt?.id !== command.commandId || typeof receipt.replayed !== 'boolean')
        throw new Error('denied');
      setPending(null);
      setData(null);
      setMessage(
        'Confirmation requested on the existing reviewed report. Nothing was sent by email.',
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'denied') {
        setData(null);
        setPending(null);
        setMessage('Authority or specification changed. Reload before requesting confirmation.');
      } else setMessage('The save was interrupted. Retry the same request.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>Request customer specification confirmation</summary>
      <p>
        Use the current requirements already approved for this client report. A customer
        confirmation never authorises a purchase, contract or payment.
      </p>
      <label>
        Reviewed publication
        <select
          value={publication}
          disabled={busy || !!pending}
          onChange={(e) => {
            controller.current?.abort();
            setPublication(e.target.value);
            setData(null);
            setPending(null);
          }}
        >
          <option value="">Choose a publication</option>
          {publications
            .filter((p) => !p.revoked)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.copy.title}
              </option>
            ))}
        </select>
      </label>
      <button type="button" disabled={busy || !publication} onClick={() => void load()}>
        Load reviewed requirements
      </button>
      {message && <p role="status">{message}</p>}
      {data && !data.requirement && (
        <p>
          No current requirement is approved for this publication. Review and publish the current
          requirements first.
        </p>
      )}
      {data?.requirement && (
        <form
          className="operator-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send(e.currentTarget);
          }}
        >
          <p>{data.requirement.declaration}</p>
          <SpecificationFields fields={data.requirement.fields} />
          <label>
            Request owner
            <select name="ownerId" required disabled={busy || !!pending}>
              {owners.map((o) => (
                <option key={o.user_id} value={o.user_id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Response deadline (UTC)
            <input name="dueAt" type="datetime-local" required disabled={busy || !!pending} />
          </label>
          <label>
            <input type="checkbox" required disabled={busy || !!pending} /> I reviewed the exact
            specification and its approved customer scope.
          </label>
          <button disabled={busy}>{pending ? 'Retry same request' : 'Request confirmation'}</button>
        </form>
      )}
      {data?.requests.map((r) => (
        <p key={r.requestId}>
          {r.confirmedAt
            ? 'Customer confirmation recorded.'
            : 'Confirmation question recorded; no typed confirmation yet.'}
        </p>
      ))}
    </details>
  );
}
