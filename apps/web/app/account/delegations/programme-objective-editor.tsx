'use client';
import { useCallback, useEffect, useRef, useState, useMemo, useId } from 'react';
import Link from 'next/link';
import { isUuid } from './participant-client';
import type { ObjectiveScope } from './programme-objectives';
type Objective = {
  id: string;
  version: number;
  status: 'SHARED' | 'WITHDRAWN' | 'UNAVAILABLE';
  requestId?: string;
  summary?: string;
};
type Choice = { id: string; label: string; available: boolean };
type Command = {
  action: 'share' | 'withdraw';
  commandId: string;
  expectedVersion: number;
  registrationId?: string;
  requestId?: string;
  summary?: string;
  consented?: true;
  linkId?: string;
  reason?: string;
  acknowledged?: true;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);
function objectives(value: unknown, scope: ObjectiveScope) {
  if (
    !object(value) ||
    value.registrationId !== scope.registrationId ||
    value.synthetic !== true ||
    typeof value.active !== 'boolean' ||
    !Array.isArray(value.objectives) ||
    value.objectives.length > 25 ||
    (value.nextAfter !== null && !isUuid(value.nextAfter)) ||
    !Number.isFinite(date(value.viewExpiresAt))
  )
    throw Error('Invalid objective response');
  const items: Objective[] = value.objectives.map((o) => {
    if (
      !object(o) ||
      !isUuid(o.id) ||
      !Number.isInteger(o.version) ||
      Number(o.version) < 1 ||
      !['SHARED', 'WITHDRAWN', 'UNAVAILABLE'].includes(String(o.status))
    )
      throw Error('Invalid objective');
    if (
      scope.view === 'manage' &&
      Object.keys(o).some(
        (k) => !['id', 'version', 'status', 'summary', 'claimStatus', 'sharedAt'].includes(k),
      )
    )
      throw Error('Unexpected private objective data');
    if (o.requestId !== undefined && (!isUuid(o.requestId) || scope.view === 'manage'))
      throw Error('Unexpected private reference');
    if (
      o.status === 'SHARED' &&
      (typeof o.summary !== 'string' ||
        !o.summary.startsWith('Synthetic ') ||
        o.summary.length > 500 ||
        /[\u0000-\u001f\u007f]/u.test(o.summary) ||
        o.claimStatus !== 'Self-declared' ||
        !Number.isFinite(date(o.sharedAt)))
    )
      throw Error('Invalid shared objective');
    if (o.status !== 'SHARED' && o.summary !== undefined) throw Error('Unexpected withdrawn text');
    return {
      id: o.id,
      version: Number(o.version),
      status: o.status as Objective['status'],
      ...(o.requestId ? { requestId: o.requestId as string } : {}),
      ...(o.summary ? { summary: o.summary as string } : {}),
    };
  });
  return {
    items,
    next: value.nextAfter as string | null,
    active: value.active,
    expiry: Math.min(date(value.viewExpiresAt), Date.now() + 60000),
  };
}
export function ProgrammeObjectiveEditor(scope: ObjectiveScope) {
  const requestSelectId = useId();
  const [items, setItems] = useState<Objective[]>([]),
    [choices, setChoices] = useState<Choice[]>([]),
    [next, setNext] = useState<string | null>(null),
    [choiceNext, setChoiceNext] = useState<string | null>(null),
    [active, setActive] = useState(false),
    [status, setStatus] = useState('loading'),
    [message, setMessage] = useState(''),
    [requestId, setRequestId] = useState(''),
    [summary, setSummary] = useState(''),
    [consent, setConsent] = useState(false),
    [target, setTarget] = useState<Objective | null>(null),
    [reason, setReason] = useState(''),
    [ack, setAck] = useState(false),
    [pending, setPending] = useState<Command | null>(null),
    [busy, setBusy] = useState(false);
  const task = useRef<AbortController | null>(null),
    inFlight = useRef(false),
    expiry = useRef(0);
  const headers = useMemo(
    () => ({
      'x-corridra-customer-subject': scope.subject,
      'x-corridra-customer-issuer': scope.issuer,
    }),
    [scope.subject, scope.issuer],
  );
  const clear = useCallback(() => {
    setItems([]);
    setChoices([]);
    setNext(null);
    setChoiceNext(null);
    setActive(false);
    setRequestId('');
    setSummary('');
    setConsent(false);
    setTarget(null);
    setReason('');
    setAck(false);
    setPending(null);
    expiry.current = 0;
  }, []);
  const read = useCallback(
    async (view: string, after?: string) => {
      const controller = new AbortController();
      task.current = controller;
      const q = new URLSearchParams({
        view,
        registrationId: scope.registrationId,
        ...(after ? { after } : {}),
      });
      const r = await fetch('/api/customer-programme-objectives?' + q, {
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!r.ok) {
        if ([401, 403, 503].includes(r.status)) {
          clear();
          setStatus('denied');
        }
        throw Error('Objective access could not be checked. Reload before making another change.');
      }
      const value = await r.json();
      if (controller.signal.aborted) throw Error('View interrupted');
      return value;
    },
    [headers, scope.registrationId, clear],
  );
  // Each mounted editor belongs to one identity,registration and role scope.
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    try {
      const q = new URLSearchParams({ view: scope.view, registrationId: scope.registrationId });
      const r = await fetch('/api/customer-programme-objectives?' + q, {
        headers: {
          'x-corridra-customer-subject': scope.subject,
          'x-corridra-customer-issuer': scope.issuer,
        },
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!r.ok) throw Error('Objective access could not be checked.');
      const v = objectives(await r.json(), {
        subject: scope.subject,
        issuer: scope.issuer,
        registrationId: scope.registrationId,
        view: scope.view,
      });
      if (v.expiry <= Date.now()) throw Error('Objective view expired.');
      if (controller.signal.aborted) return;
      expiry.current = v.expiry;
      setItems(v.items);
      setNext(v.next);
      setActive(v.active);
      setStatus('ready');
      setMessage('');
    } catch {
      if (!controller.signal.aborted) {
        clear();
        setStatus('denied');
        setMessage('Objective access could not be checked. Reload to try again.');
      }
    } finally {
      inFlight.current = false;
    }
  }, [scope.subject, scope.issuer, scope.registrationId, scope.view, clear]);
  useEffect(() => {
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) return load();
    });
    const hide = () => {
      task.current?.abort();
      clear();
      setStatus('expired');
      setMessage('Private details and drafts were cleared. Reload to check current access.');
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') hide();
    };
    const tick = setInterval(() => {
      if (expiry.current && Date.now() >= expiry.current) hide();
    }, 250);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted = false;
      clearInterval(tick);
      task.current?.abort();
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load, clear]);
  useEffect(() => {
    const protect = (e: BeforeUnloadEvent) => {
      if (summary || reason || pending) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const close = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        detail?.registrationId === scope.registrationId &&
        detail?.view === scope.view &&
        (summary || reason || pending)
      ) {
        event.preventDefault();
        setMessage(
          pending
            ? 'Resolve the pending change before closing these tools.'
            : 'Your objective draft is unsaved. Save it or clear the text before closing these tools.',
        );
      }
    };
    window.addEventListener('beforeunload', protect);
    window.addEventListener('corridra-objective-close', close);
    return () => {
      window.removeEventListener('beforeunload', protect);
      window.removeEventListener('corridra-objective-close', close);
    };
  }, [summary, reason, pending, scope.registrationId, scope.view]);
  const more = useCallback(
    async (after: string) => {
      if (inFlight.current || Date.now() >= expiry.current) return;
      inFlight.current = true;
      setBusy(true);
      const before = expiry.current;
      try {
        const v = objectives(await read(scope.view, after), scope);
        if (Date.now() >= before) throw Error('View expired.');
        expiry.current = Math.min(before, v.expiry);
        setItems((old) => [...old, ...v.items.filter((x) => !old.some((o) => o.id === x.id))]);
        setNext(v.next);
      } catch {
        clear();
        setStatus('denied');
        setMessage('Objective access changed. Reload to check current access.');
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [read, scope, clear],
  );
  const choose = useCallback(
    async (after?: string) => {
      if (inFlight.current || Date.now() >= expiry.current) return;
      inFlight.current = true;
      setBusy(true);
      const before = expiry.current;
      try {
        const v = await read('choices', after);
        if (
          !object(v) ||
          v.registrationId !== scope.registrationId ||
          v.synthetic !== true ||
          !Array.isArray(v.requests) ||
          v.requests.length > 25 ||
          (v.nextAfter !== null && !isUuid(v.nextAfter)) ||
          !Number.isFinite(date(v.viewExpiresAt))
        )
          throw Error('Invalid choice view');
        const rows: Choice[] = v.requests.map((r) => {
          if (
            !object(r) ||
            !isUuid(r.id) ||
            typeof r.available !== 'boolean' ||
            typeof r.label !== 'string' ||
            r.label.length > 1000
          )
            throw Error('Invalid private request choice');
          return { id: r.id, available: r.available, label: r.label };
        });
        expiry.current = Math.min(before, date(v.viewExpiresAt));
        if (expiry.current <= Date.now()) throw Error('Choice view expired');
        setChoices((old) =>
          after ? [...old, ...rows.filter((r) => !old.some((o) => o.id === r.id))] : rows,
        );
        setChoiceNext(v.nextAfter as string | null);
        setMessage(
          rows.length
            ? 'Choose one of your original private requests.'
            : 'No eligible original private requests were found.',
        );
      } catch {
        clear();
        setStatus('denied');
        setMessage('Private requests could not be checked. Reload before sharing.');
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [read, scope.registrationId, clear],
  );
  const send = useCallback(
    async (command: Command) => {
      if (inFlight.current || Date.now() >= expiry.current) return;
      inFlight.current = true;
      setBusy(true);
      setPending(command);
      const controller = new AbortController();
      task.current = controller;
      try {
        const r = await fetch('/api/customer-programme-objectives', {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          body: JSON.stringify(command),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!r.ok) {
          if ([401, 403, 503].includes(r.status)) {
            clear();
            setStatus('denied');
            throw Error('Access changed. Private details and drafts were cleared.');
          }
          if (r.status >= 400 && r.status < 500) {
            setPending(null);
            throw Error(
              'This change was not accepted. Reload to check the latest objective version.',
            );
          }
          throw Error(
            'The result is uncertain. Retry this exact change before doing anything else.',
          );
        }
        const v = await r.json();
        if (
          !object(v) ||
          !isUuid(v.id) ||
          v.registrationId !== scope.registrationId ||
          v.synthetic !== true ||
          !Number.isInteger(v.version) ||
          Number(v.version) < 1 ||
          Number(v.version) < command.expectedVersion ||
          Number(v.version) > command.expectedVersion + 1 ||
          (command.action === 'share' && v.requestId !== command.requestId) ||
          v.status !== (command.action === 'share' ? 'SHARED' : 'WITHDRAWN') ||
          (command.action === 'withdraw' && v.id !== command.linkId)
        )
          throw Error('The result could not be checked. Retry this exact change.');
        if (controller.signal.aborted) return;
        setPending(null);
        setSummary('');
        setConsent(false);
        setTarget(null);
        setReason('');
        setAck(false);
        setChoices([]);
        setRequestId('');
        inFlight.current = false;
        await load();
      } catch (e) {
        if (!controller.signal.aborted)
          setMessage(e instanceof Error ? e.message : 'This change could not be checked.');
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [headers, scope.registrationId, clear, load],
  );
  const current = items.find((o) => o.requestId === requestId);
  return (
    <section aria-label="Shared commercial objectives" className="operator-form">
      <h4>Shared commercial objectives</h4>
      <p>
        Sample objectives only. These are self-declared intentions, not qualification, confirmed
        meetings or business outcomes.
      </p>
      <p>
        Only explicitly shared text is visible to programme organisers. Original requests, contacts,
        quotations and commercial values remain private.
      </p>
      {message && <p role="status">{message}</p>}
      {status === 'loading' && <p role="status">Checking current access…</p>}
      {!busy && !pending && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            clear();
            void load();
          }}
        >
          Reload shared objectives
        </button>
      )}
      {status === 'ready' && (
        <>
          {items.length === 0 && <p>No shared commercial objectives.</p>}
          <ul>
            {items.map((o) => (
              <li key={o.id}>
                <p>
                  {o.status === 'SHARED'
                    ? o.summary
                    : o.status === 'WITHDRAWN'
                      ? 'Objective sharing withdrawn.'
                      : 'Original source or programme access is unavailable.'}
                </p>
                {o.status === 'SHARED' && <p>Self-declared · stated by the participant</p>}
                {scope.view === 'own' && o.requestId && (
                  <Link className="text-link" href={'/account/requests/' + o.requestId}>
                    Open my original private request
                  </Link>
                )}
                {scope.view === 'own' && o.status !== 'WITHDRAWN' && !pending && (
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => {
                      setTarget(o);
                      setReason('');
                      setAck(false);
                    }}
                  >
                    Withdraw this shared objective
                  </button>
                )}
                {target?.id === o.id && !pending && (
                  <>
                    <label className="field">
                      Reason for objective withdrawal
                      <textarea
                        value={reason}
                        minLength={10}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                        disabled={busy}
                      />
                      I understand this ends objective sharing without cancelling my private request
                      or programme registration.
                    </label>
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || !ack || reason.trim().length < 10}
                      onClick={() =>
                        void send({
                          action: 'withdraw',
                          commandId: crypto.randomUUID(),
                          linkId: o.id,
                          expectedVersion: o.version,
                          reason: reason.trim(),
                          acknowledged: true,
                        })
                      }
                    >
                      Confirm objective withdrawal
                    </button>
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => {
                        setTarget(null);
                        setReason('');
                        setAck(false);
                      }}
                    >
                      Cancel objective withdrawal
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {next && !pending && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => void more(next)}
            >
              Load more shared objectives
            </button>
          )}
          {scope.view === 'own' && active && !pending && (
            <>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => void choose()}
              >
                Choose an existing private request
              </button>
              {choices.length > 0 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (
                      !isUuid(requestId) ||
                      !consent ||
                      !summary.startsWith('Synthetic ') ||
                      summary.trim().length < 11 ||
                      summary.length > 500 ||
                      /[\u0000-\u001f\u007f]/u.test(summary)
                    ) {
                      setMessage(
                        'Choose your private request, write a fictional objective beginning with Synthetic, and confirm sharing consent.',
                      );
                      return;
                    }
                    void send({
                      action: 'share',
                      commandId: crypto.randomUUID(),
                      registrationId: scope.registrationId,
                      requestId,
                      summary: summary.trim(),
                      expectedVersion: current?.version ?? 0,
                      consented: true,
                    });
                  }}
                >
                  <div className="field">
                    <label htmlFor={requestSelectId}>Original private request</label>
                    <select
                      id={requestSelectId}
                      value={requestId}
                      onChange={(e) => {
                        setRequestId(e.target.value);
                        setConsent(false);
                      }}
                      disabled={busy}
                      required
                    >
                      <option value="">Choose your request</option>
                      {choices.map((r) => (
                        <option key={r.id} value={r.id} disabled={!r.available}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {choiceNext && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => void choose(choiceNext)}
                    >
                      Load more private requests
                    </button>
                  )}
                  <label className="field">
                    Fictional objective to share
                    <textarea
                      value={summary}
                      minLength={11}
                      maxLength={500}
                      required
                      placeholder="Synthetic supplier objective"
                      disabled={busy}
                      onChange={(e) => {
                        setSummary(e.target.value);
                        setConsent(false);
                      }}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      disabled={busy}
                      required
                    />
                    I consent to programme organisers seeing only this objective text. Ending
                    participation, withdrawing this sharing or losing original-request access ends
                    its visibility.
                  </label>
                  <button className="button button-primary" disabled={busy || !consent}>
                    {current ? 'Update shared objective' : 'Share objective with organisers'}
                  </button>
                </form>
              )}
            </>
          )}
          {pending && (
            <>
              <p role="alert">
                Keep this exact change until its result is known. Reload after leaving this page
                before making a new change.
              </p>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void send(pending)}
              >
                Retry exact objective change
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
