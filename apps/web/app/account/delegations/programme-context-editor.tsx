'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ProgrammeContextScope } from './programme-context';
type Details = {
  organiser: string;
  marketCode: string;
  purpose: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  reason: string;
};
type Snapshot = {
  programmeId: string;
  workspaceId?: string;
  registrationId?: string;
  synthetic: boolean;
  expiresAt: string;
  currentVersion?: number;
  shared?: boolean;
  reason?: string | null;
  commandId?: string;
  context: (Omit<Details, 'reason'> & { version: number; updatedAt: string }) | null;
};
const empty: Details = {
  organiser: '',
  marketCode: '',
  purpose: '',
  startsAt: '',
  endsAt: '',
  timezone: '',
  reason: '',
};
function parse(value: unknown, scope: ProgrammeContextScope): Snapshot {
  const v = value as Snapshot;
  if (
    !v ||
    !customerProvenanceAllowed(v.synthetic) ||
    v.programmeId !== scope.programmeId ||
    !Number.isFinite(Date.parse(v.expiresAt)) ||
    Date.parse(v.expiresAt) <= Date.now() ||
    Date.parse(v.expiresAt) > Date.now() + 65000
  )
    throw Error('Invalid programme details');
  if (
    scope.registrationId
      ? v.registrationId !== scope.registrationId
      : v.workspaceId !== scope.workspaceId ||
        !Number.isInteger(v.currentVersion) ||
        typeof v.shared !== 'boolean'
  )
    throw Error('Programme scope changed');
  if (v.context !== null) {
    if (
      !v.context ||
      !Number.isInteger(v.context.version) ||
      v.context.version < 1 ||
      !['organiser', 'marketCode', 'purpose', 'startsAt', 'endsAt', 'timezone', 'updatedAt'].every(
        (k) => typeof v.context?.[k as keyof typeof v.context] === 'string',
      ) ||
      !Number.isFinite(Date.parse(v.context.startsAt)) ||
      !Number.isFinite(Date.parse(v.context.endsAt))
    )
      throw Error('Invalid context');
  }
  return v;
}
export function ProgrammeContextEditor(props: ProgrammeContextScope & { onClose: () => void }) {
  const { subject, issuer, programmeId, workspaceId, registrationId, onClose } = props;
  const id = useId(),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [draft, setDraft] = useState<Details>(empty),
    [shared, setShared] = useState(false),
    [ack, setAck] = useState(false),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('Loading programme details…'),
    [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const active = useRef(false),
    task = useRef<AbortController | null>(null),
    flight = useRef(false);
  const clear = useCallback((why: string) => {
    task.current?.abort();
    flight.current = false;
    setBusy(false);
    setSnapshot(null);
    setDraft(empty);
    setShared(false);
    setAck(false);
    setDirty(false);
    setPending(null);
    setMessage(why);
  }, []);
  const apply = useCallback((v: Snapshot) => {
    setSnapshot(v);
    setDraft(
      v.context
        ? {
            organiser: v.context.organiser,
            marketCode: v.context.marketCode,
            purpose: v.context.purpose,
            startsAt: v.context.startsAt,
            endsAt: v.context.endsAt,
            timezone: v.context.timezone,
            reason: v.reason ?? '',
          }
        : empty,
    );
    setShared(v.shared ?? false);
    setAck(false);
    setDirty(false);
    setPending(null);
    setMessage(v.context ? 'Programme details loaded.' : 'No programme details have been shared.');
  }, []);
  const request = useCallback(
    async (body?: Record<string, unknown>) => {
      if (flight.current) return;
      flight.current = true;
      setBusy(true);
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const scope: Record<string, string> = registrationId
          ? { registrationId }
          : { workspaceId: workspaceId!, programmeId };
        const r = await fetch(
          '/api/customer-programme-context' + (body ? '' : '?' + new URLSearchParams(scope)),
          {
            method: body ? 'POST' : 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: {
              'x-corridra-customer-subject': subject,
              'x-corridra-customer-issuer': issuer,
              ...(body ? { 'content-type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
          },
        );
        if (!active.current || controller.signal.aborted) return;
        if ([401, 403].includes(r.status)) {
          clear('Programme access changed. Local details were cleared.');
          return;
        }
        if (r.status === 409) {
          clear('Programme details changed. Reload before editing.');
          return;
        }
        if (r.status === 503) {
          clear(
            realCustomerInput()
              ? 'Programme details are unavailable.'
              : 'Sample programme details are unavailable.',
          );
          return;
        }
        if (r.status === 400) {
          setPending(null);
          setMessage(
            'Check the country code, dates with UTC offsets, time zone and required text, then save again.',
          );
          return;
        }
        if (!r.ok) throw Error('Programme request failed');
        const v = parse(await r.json(), {
          subject,
          issuer,
          programmeId,
          workspaceId,
          registrationId,
        });
        if (
          body &&
          (v.commandId !== body.commandId || v.currentVersion !== Number(body.expectedVersion) + 1)
        )
          throw Error('Save acknowledgement did not match');
        if (active.current && !controller.signal.aborted) {
          apply(v);
          setMessage(body ? 'Programme details saved.' : 'Programme details loaded.');
        }
      } catch {
        if (active.current)
          setMessage(
            body
              ? 'Save could not be confirmed. Retry the same save.'
              : 'Programme details could not be loaded. Try again.',
          );
      } finally {
        clearTimeout(timeout);
        if (active.current) {
          flight.current = false;
          setBusy(false);
        }
      }
    },
    [subject, issuer, workspaceId, programmeId, registrationId, apply, clear],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void request();
    });
    const hide = () => {
      if (document.visibilityState === 'hidden')
        clear('Details cleared while away. Reload to check access.');
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      active.current = false;
      task.current?.abort();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [request, clear]);
  useEffect(() => {
    if (!snapshot) return;
    const timer = setTimeout(
      () => clear('Programme access must be checked again. Reload details.'),
      Math.max(0, Date.parse(snapshot.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [snapshot, clear]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const leave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty, pending]);
  const close = () => {
    if (
      (dirty || pending) &&
      !window.confirm('Discard local programme edits or an unconfirmed save?')
    )
      return;
    clear('');
    onClose();
  };
  const submit = useCallback(() => {
    if (!snapshot || registrationId || !ack || busy) return;
    const body = pending ?? {
      commandId: crypto.randomUUID(),
      workspaceId,
      programmeId,
      expectedVersion: snapshot.currentVersion,
      ...draft,
      shared,
      acknowledged: true,
    };
    setPending(body);
    void request(body);
  }, [
    snapshot,
    registrationId,
    ack,
    busy,
    pending,
    workspaceId,
    programmeId,
    draft,
    shared,
    request,
  ]);
  return (
    <section aria-label="Programme details">
      <p>
        {' '}
        {realCustomerInput()
          ? 'Planning only. A target market does not confirm local service availability.'
          : 'Sample planning only. A target market does not confirm local service availability.'}{' '}
      </p>
      <p role="status">{message}</p>
      {snapshot?.context && (
        <dl>
          <dt>Organiser</dt>
          <dd>{snapshot.context.organiser}</dd>
          <dt>Target country or trade bloc</dt>
          <dd>{snapshot.context.marketCode}</dd>
          <dt>Purpose</dt>
          <dd>{snapshot.context.purpose}</dd>
          <dt>Dates</dt>
          <dd>
            {snapshot.context.startsAt} to {snapshot.context.endsAt}
          </dd>
          <dt>Time zone</dt>
          <dd>{snapshot.context.timezone}</dd>
          <dt>Version</dt>
          <dd>{snapshot.context.version}</dd>
        </dl>
      )}
      {snapshot && !registrationId && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={busy || !!pending}>
            <legend>
              {' '}
              {realCustomerInput()
                ? 'Edit programme details'
                : 'Edit sample programme details'}{' '}
            </legend>
            {(Object.keys(empty) as (keyof Details)[]).map((key) => (
              <div key={key}>
                <label htmlFor={id + key}>
                  {
                    {
                      organiser: realCustomerInput()
                        ? 'Organiser'
                        : 'Organiser (start with Synthetic)',
                      marketCode: 'Target country code or EU trade bloc',
                      purpose: realCustomerInput() ? 'Purpose' : 'Purpose (start with Synthetic)',
                      startsAt: 'Start date and time with UTC offset',
                      endsAt: 'End date and time with UTC offset',
                      timezone: 'IANA time zone',
                      reason: 'Reason for change',
                    }[key]
                  }
                </label>
                <input
                  id={id + key}
                  required
                  minLength={
                    key === 'organiser' || key === 'purpose' ? 11 : key === 'reason' ? 3 : 2
                  }
                  maxLength={1000}
                  placeholder={
                    key === 'startsAt' || key === 'endsAt'
                      ? '2026-12-01T09:00:00+06:00'
                      : key === 'timezone'
                        ? 'Asia/Dhaka'
                        : key === 'marketCode'
                          ? 'CN or EU'
                          : undefined
                  }
                  value={draft[key]}
                  onChange={(e) => {
                    setDraft({ ...draft, [key]: e.target.value });
                    setDirty(true);
                  }}
                />
              </div>
            ))}
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                marginBlock: '1rem',
              }}
            >
              <input
                type="checkbox"
                checked={shared}
                onChange={(e) => {
                  setShared(e.target.checked);
                  setDirty(true);
                }}
              />
              Share these programme details with active registered participants
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                marginBlock: '1rem',
              }}
            >
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I
              confirm these details are accurate to the best of my knowledge.{' '}
            </label>
          </fieldset>
          <button type="submit" className="button button-primary" disabled={busy || !ack}>
            {pending ? 'Retry same save' : 'Save programme details'}
          </button>
        </form>
      )}
      {!dirty && !pending && (
        <button type="button" className="text-link" disabled={busy} onClick={() => void request()}>
          Reload programme details
        </button>
      )}
      <button type="button" className="text-link" disabled={busy} onClick={close}>
        Close programme details
      </button>
    </section>
  );
}
