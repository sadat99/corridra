'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  basisText,
  callServiceApi,
  contextText,
  problemText,
  unconfirmed,
  validCatalogue,
  type CatalogueResult,
  type ServiceRequestSummary,
} from './service-request-client';

type Workspace = { id: string; name: string; role: string };
type Props = {
  subject: string;
  issuer: string;
  kind: 'request' | 'programme' | 'company';
  contextRef: string;
  workspaceId: string | null;
};
const starter = 'Synthetic ';

export function ServiceRequestNew(props: Props) {
  return (
    <ScopedNew
      key={[props.issuer, props.subject, props.kind, props.contextRef, props.workspaceId].join(':')}
      {...props}
    />
  );
}
function ScopedNew({ subject, issuer, kind, contextRef, workspaceId }: Props) {
  const id = useId();
  const [catalogue, setCatalogue] = useState<CatalogueResult | null>(null),
    [workspaces, setWorkspaces] = useState<Workspace[] | null>(workspaceId ? [] : null),
    [workspace, setWorkspace] = useState(workspaceId ?? ''),
    [service, setService] = useState(''),
    [region, setRegion] = useState(''),
    [need, setNeed] = useState(starter),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [state, setState] = useState<'loading' | 'ready' | 'error' | 'off'>('loading'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Record<string, unknown> | null>(null),
    [done, setDone] = useState<ServiceRequestSummary | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void (async () => {
      const result = await callServiceApi<CatalogueResult>(
        { subject, issuer },
        { scope: 'catalogue' },
        null,
        validCatalogue,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setState(result.status === 503 ? 'off' : 'error');
        setMessage(problemText(result.status, 'load the list of services'));
        return;
      }
      setCatalogue(result.data);
      if (!workspaceId) {
        try {
          const response = await fetch('/api/customer-workspaces', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'x-corridra-customer-subject': subject,
              'x-corridra-customer-issuer': issuer,
            },
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('workspaces');
          const body = (await response.json()) as { workspaces?: Workspace[] };
          const mine = (body.workspaces ?? []).filter((w) => ['owner', 'admin'].includes(w.role));
          if (controller.signal.aborted) return;
          setWorkspaces(mine);
          if (mine.length === 1) setWorkspace(mine[0].id);
        } catch {
          if (controller.signal.aborted) return;
          setState('error');
          setMessage('Could not load your workspaces. Check your connection and try again.');
          return;
        }
      }
      setState('ready');
    })();
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [subject, issuer, workspaceId]);
  useEffect(() => {
    if (!pending) return;
    const leave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [pending]);
  const chosen = catalogue?.services.find((s) => s.key === service) ?? null;
  const edit =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      // Any change is a new request, so it gets a new command id.
      setPending(null);
    };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !chosen) return;
    const body = pending ?? {
      action: 'create',
      commandId: crypto.randomUUID(),
      workspaceId: workspace,
      contextKind: kind,
      contextRef,
      serviceKey: chosen.key,
      need: need.trim(),
      preferredFrom: from || null,
      preferredTo: to || null,
      region,
    };
    setPending(body);
    setBusy(true);
    setMessage('');
    const result = await callServiceApi<ServiceRequestSummary>(
      { subject, issuer },
      null,
      body,
      (v) => typeof (v as ServiceRequestSummary | null)?.id === 'string',
    );
    if (!alive.current) return;
    setBusy(false);
    if (!result.ok) {
      // A network failure keeps the same command id so the retry cannot send the request twice.
      const unsure = unconfirmed(result.status);
      if (!unsure) setPending(null);
      setMessage(
        unsure
          ? 'We could not confirm that the request was sent. Send it again; it cannot be sent twice.'
          : problemText(result.status, 'send the request'),
      );
      return;
    }
    setPending(null);
    setDone(result.data);
  }
  if (done)
    return (
      <section aria-label="Help request sent">
        <div className="ux-state" data-state="complete">
          <p className="ux-state-label">Request sent</p>
          <div role="status">
            Your request for {done.serviceTitle} was sent. We will prepare a quote. Nothing is
            charged.
          </div>
          <div className="ux-state-actions">
            <a
              className="button"
              href={'/account/service-requests/' + done.workspaceId + '/' + done.id}
            >
              View your request
            </a>
            <a className="text-link" href={'/account/service-requests/' + done.workspaceId}>
              All help requests
            </a>
          </div>
        </div>
      </section>
    );
  return (
    <section aria-label="Request help">
      <p>
        You are asking for paid local help linked to your{' '}
        <strong>{contextText[kind].toLowerCase()}</strong>. We reply with a quote that lists every
        cost and everything left out. Accepting it records your order intent only. Nothing is
        charged and billing is not switched on.
      </p>
      {state === 'loading' && <p role="status">Loading the services…</p>}
      {(state === 'error' || state === 'off') && (
        <div className="ux-state" data-state="unavailable">
          <p className="ux-state-label">Temporarily unavailable</p>
          <div role="alert">{message}</div>
          <div className="ux-state-actions">
            <a className="text-link" href="/account">
              Return to your account
            </a>
          </div>
        </div>
      )}
      {state === 'ready' && workspaces && workspaces.length === 0 && !workspaceId && (
        <div className="ux-state" data-state="denied">
          <p className="ux-state-label">Owner or admin needed</p>
          <div role="alert">
            Only an owner or admin of a workspace can ask for paid help. You have no workspace like
            that.
          </div>
        </div>
      )}
      {state === 'ready' && catalogue && (workspaceId || (workspaces && workspaces.length > 0)) && (
        <form onSubmit={(e) => void submit(e)} aria-label="Help request details">
          <fieldset disabled={busy}>
            {!workspaceId && workspaces && workspaces.length > 1 && (
              <div className="field">
                <label htmlFor={id + 'workspace'}>Workspace</label>
                <select
                  id={id + 'workspace'}
                  required
                  value={workspace}
                  onChange={(e) => edit(setWorkspace)(e.target.value)}
                >
                  <option value="">Choose a workspace</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <fieldset>
              <legend>Which help do you need?</legend>
              {catalogue.services.length === 0 && <p>No services are offered right now.</p>}
              {catalogue.services.map((s) => (
                <div key={s.key} className="detail-card">
                  <label>
                    <input
                      type="radio"
                      name="service"
                      value={s.key}
                      checked={service === s.key}
                      onChange={() => {
                        edit(setService)(s.key);
                        setRegion('');
                      }}
                      required
                    />{' '}
                    <strong>{s.title}</strong> · {basisText[s.quoteBasis]}
                  </label>
                  <p>{s.summary}</p>
                  <details>
                    <summary>What is and is not included</summary>
                    <p>Included</p>
                    <ul>
                      {s.included.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                    <p>Not included</p>
                    <ul>
                      {s.excluded.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            </fieldset>
            {chosen && (
              <>
                <div className="field">
                  <label htmlFor={id + 'region'}>Where do you need it?</label>
                  <select
                    id={id + 'region'}
                    required
                    value={region}
                    onChange={(e) => edit(setRegion)(e.target.value)}
                  >
                    <option value="">Choose a place</option>
                    {chosen.regions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={id + 'need'}>What do you need? (start with Synthetic)</label>
                  <textarea
                    id={id + 'need'}
                    required
                    minLength={11}
                    maxLength={1000}
                    rows={4}
                    value={need}
                    onChange={(e) => edit(setNeed)(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={id + 'from'}>Earliest date (optional)</label>
                  <input
                    id={id + 'from'}
                    type="date"
                    value={from}
                    onChange={(e) => edit(setFrom)(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor={id + 'to'}>Latest date (optional)</label>
                  <input
                    id={id + 'to'}
                    type="date"
                    min={from || undefined}
                    value={to}
                    onChange={(e) => edit(setTo)(e.target.value)}
                  />
                </div>
              </>
            )}
          </fieldset>
          {message && <p role="alert">{message}</p>}
          <button
            type="submit"
            className="button"
            disabled={
              busy ||
              !chosen ||
              !region ||
              !workspace ||
              !need.startsWith('Synthetic ') ||
              need.trim().length < 11
            }
          >
            {pending ? 'Send the same request again' : 'Send help request'}
          </button>
        </form>
      )}
      <p>
        <a className="text-link" href="/account">
          Cancel and return to your account
        </a>
      </p>
    </section>
  );
}
