'use client';
import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState } from 'react';
export type ParticipantScope = {
  subject: string;
  issuer: string;
  workspaceId?: string;
  programmeId?: string;
};
export type Invitation = {
  id: string;
  label: string;
  expiresAt: string;
  status: 'ISSUED' | 'USED' | 'UNAVAILABLE';
};
export type Registration = {
  id: string;
  programmeId?: string;
  displayLabel?: string;
  consentedAt?: string;
  name?: string;
  reportingPurpose?: string;
  status: 'REGISTERED' | 'REVOKED' | 'WITHDRAWN';
};
type View = {
  invitations: Invitation[];
  registrations: Registration[];
  nextInvitationAfter: string | null;
  nextRegistrationAfter: string | null;
};
export type ParticipantCommand = Record<string, unknown> & { action: string; commandId?: string };
export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const syntheticLabel = (v: unknown): v is string =>
  text(v, 11, 120) && customerLabelAllowed(v) && !/[\u0000-\u001f\u007f]/u.test(v);
export function parseParticipantView(value: unknown, scope: ParticipantScope): View {
  if (
    !object(value) ||
    !customerProvenanceAllowed(value.synthetic) ||
    !Array.isArray(value.registrations) ||
    value.registrations.length > 25
  )
    throw Error('Invalid participant view');
  const manage = !!scope.programmeId;
  if (
    manage &&
    (value.workspaceId !== scope.workspaceId || value.programmeId !== scope.programmeId)
  )
    throw Error('Participant scope changed');
  const registrations: Registration[] = value.registrations.map((r) => {
    if (
      !object(r) ||
      !isUuid(r.id) ||
      !['REGISTERED', 'REVOKED', 'WITHDRAWN'].includes(String(r.status))
    )
      throw Error('Invalid registration');
    const base = { id: r.id, status: r.status as Registration['status'] };
    if (manage) {
      if (!syntheticLabel(r.displayLabel) || !date(r.consentedAt))
        throw Error('Invalid registration');
      return { ...base, displayLabel: r.displayLabel, consentedAt: r.consentedAt };
    }
    if (!isUuid(r.programmeId) || !customerProvenanceAllowed(r.synthetic))
      throw Error('Invalid own registration');
    if (r.status !== 'REGISTERED') return { ...base, programmeId: r.programmeId };
    if (
      !text(r.name, 3, 160) ||
      !text(r.reportingPurpose, 10, 500) ||
      !syntheticLabel(r.displayLabel) ||
      !date(r.consentedAt)
    )
      throw Error('Invalid programme metadata');
    return {
      ...base,
      programmeId: r.programmeId,
      name: r.name,
      reportingPurpose: r.reportingPurpose,
      displayLabel: r.displayLabel,
      consentedAt: r.consentedAt,
    };
  });
  let invitations: Invitation[] = [];
  if (manage) {
    if (!Array.isArray(value.invitations) || value.invitations.length > 25)
      throw Error('Invalid invitations');
    invitations = value.invitations.map((i) => {
      if (
        !object(i) ||
        !isUuid(i.id) ||
        !syntheticLabel(i.label) ||
        !date(i.expiresAt) ||
        !['ISSUED', 'USED', 'UNAVAILABLE'].includes(String(i.status))
      )
        throw Error('Invalid invitation');
      return {
        id: i.id,
        label: i.label,
        expiresAt: i.expiresAt,
        status: (i.status === 'ISSUED' && Date.parse(i.expiresAt) <= Date.now()
          ? 'UNAVAILABLE'
          : i.status) as Invitation['status'],
      };
    });
  }
  const nextI = manage ? value.nextInvitationAfter : null,
    nextR = manage ? value.nextRegistrationAfter : value.nextAfter;
  for (const [rows, next] of [
    [invitations, nextI],
    [registrations, nextR],
  ] as const)
    if (
      new Set(rows.map((r) => r.id)).size !== rows.length ||
      !(next === null || (isUuid(next) && next === rows.at(-1)?.id))
    )
      throw Error('Invalid participant cursor');
  return {
    invitations,
    registrations,
    nextInvitationAfter: nextI as string | null,
    nextRegistrationAfter: nextR as string | null,
  };
}
export function parseParticipantResult(value: unknown, payload: ParticipantCommand) {
  if (!object(value) || !customerProvenanceAllowed(value.synthetic) || !isUuid(value.programmeId))
    throw Error('Unconfirmed participant response');
  if (payload.programmeId && value.programmeId !== payload.programmeId)
    throw Error('Unconfirmed programme scope');
  if (payload.action === 'preview') {
    if (
      !text(value.name, 3, 160) ||
      !text(value.reportingPurpose, 10, 500) ||
      !date(value.expiresAt) ||
      Date.parse(value.expiresAt) <= Date.now()
    )
      throw Error('Invalid invitation preview');
    return {
      action: 'preview',
      programmeId: value.programmeId,
      name: value.name,
      reportingPurpose: value.reportingPurpose,
      expiresAt: value.expiresAt,
    };
  }
  if (!isUuid(value.id)) throw Error('Unconfirmed participant response');
  if (payload.action === 'invite') {
    if (
      !date(value.expiresAt) ||
      typeof value.issued !== 'boolean' ||
      (value.issued
        ? !text(value.token, 43, 43) ||
          !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
          Date.parse(value.expiresAt) <= Date.now()
        : value.token !== null)
    )
      throw Error('Unconfirmed invitation issuance');
    return {
      action: 'invite',
      id: value.id,
      programmeId: value.programmeId,
      expiresAt: value.expiresAt,
      issued: value.issued,
      token: value.issued ? value.token : null,
    };
  }
  const expected =
    payload.action === 'accept'
      ? ['REGISTERED']
      : payload.action === 'withdraw'
        ? ['WITHDRAWN']
        : ['REVOKED', 'WITHDRAWN'];
  if (
    !expected.includes(String(value.status)) ||
    (payload.targetId && value.id !== payload.targetId) ||
    (payload.registrationId && value.id !== payload.registrationId)
  )
    throw Error('Unconfirmed participant outcome');
  return {
    action: payload.action,
    id: value.id,
    programmeId: value.programmeId,
    status: value.status,
  };
}
export function useParticipantView(
  scope: ParticipantScope,
  clearDraft: () => void,
  onOutcome?: (command: ParticipantCommand) => void,
) {
  const { subject, issuer, workspaceId, programmeId } = scope;
  const [data, setData] = useState<View | null>(null),
    [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'unavailable' | 'denied'>(
      'loading',
    );
  const [busy, setBusy] = useState(false),
    [visible, setVisible] = useState(true),
    [notice, setNotice] = useState('');
  const [pending, setPending] = useState<ParticipantCommand | null>(null),
    [result, setResult] = useState<Record<string, unknown> | null>(null);
  const active = useRef(false),
    available = useRef(false),
    get = useRef<AbortController | null>(null),
    post = useRef<AbortController | null>(null),
    reading = useRef(false),
    writing = useRef(false),
    intent = useRef<ParticipantCommand | null>(null),
    deadline = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expire = useCallback(() => {
    available.current = false;
    if (timer.current) clearTimeout(timer.current);
    get.current?.abort();
    post.current?.abort();
    reading.current = false;
    writing.current = false;
    setBusy(false);
    setData(null);
    setResult(null);
    setStatus('failed');
    setNotice('This private view expired. Reload to check access again.');
  }, []);
  const deny = useCallback(() => {
    available.current = false;
    if (timer.current) clearTimeout(timer.current);
    intent.current = null;
    setPending(null);
    setData(null);
    setResult(null);
    setStatus('denied');
    setNotice('Account or programme access changed. Private details were cleared.');
    clearDraft();
  }, [clearDraft]);
  const load = useCallback(
    async (which?: 'invitations' | 'registrations', cursor?: string, preserveResult = false) => {
      if (reading.current || writing.current || !active.current) return;
      reading.current = true;
      setBusy(true);
      if (!which) {
        available.current = false;
        deadline.current = 0;
        if (timer.current) clearTimeout(timer.current);
        setData(null);
        setStatus('loading');
        if (!preserveResult) {
          setResult(null);
          setNotice('');
        }
      }
      const task = new AbortController();
      get.current = task;
      try {
        const query = new URLSearchParams(
          programmeId
            ? { view: 'manage', workspaceId: workspaceId!, programmeId }
            : { view: 'own' },
        );
        if (which && cursor)
          query.set(
            programmeId
              ? which === 'invitations'
                ? 'invitationAfter'
                : 'registrationAfter'
              : 'after',
            cursor,
          );
        const response = await fetch('/api/customer-programme-participants?' + query, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer },
          signal: task.signal,
        });
        if (task.signal.aborted || !active.current) return;
        if ([401, 403, 409].includes(response.status)) {
          deny();
          return;
        }
        if (response.status === 503) {
          available.current = false;
          if (timer.current) clearTimeout(timer.current);
          setData(null);
          setResult(null);
          setStatus('unavailable');
          return;
        }
        if (!response.ok) throw Error('Participant read failed');
        const value = parseParticipantView(await response.json(), {
          subject,
          issuer,
          workspaceId,
          programmeId,
        });
        if (task.signal.aborted || !active.current) return;
        if (!which) deadline.current = Date.now() + 60000;
        for (const invitation of value.invitations)
          if (invitation.status === 'ISSUED')
            deadline.current = Math.min(deadline.current, Date.parse(invitation.expiresAt));
        if (deadline.current <= Date.now()) {
          expire();
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(expire, deadline.current - Date.now());
        setData((old) => {
          if (!which || !old) return value;
          if (which === 'invitations')
            return {
              ...old,
              invitations: [
                ...old.invitations,
                ...value.invitations.filter((r) => !old.invitations.some((p) => p.id === r.id)),
              ],
              nextInvitationAfter: value.nextInvitationAfter,
            };
          return {
            ...old,
            registrations: [
              ...old.registrations,
              ...value.registrations.filter((r) => !old.registrations.some((p) => p.id === r.id)),
            ],
            nextRegistrationAfter: value.nextRegistrationAfter,
          };
        });
        available.current = true;
        setStatus('ready');
      } catch {
        if (!task.signal.aborted && active.current) {
          available.current = false;
          if (timer.current) clearTimeout(timer.current);
          setData(null);
          setResult(null);
          setStatus('failed');
          setNotice('Participant details could not be checked. Reload to try again.');
        }
      } finally {
        if (!task.signal.aborted && active.current) {
          reading.current = false;
          setBusy(false);
        }
      }
    },
    [subject, issuer, workspaceId, programmeId, deny, expire],
  );
  const send = useCallback(
    async (payload: ParticipantCommand) => {
      if (
        writing.current ||
        reading.current ||
        !active.current ||
        !available.current ||
        status !== 'ready'
      )
        return;
      if (deadline.current <= Date.now()) {
        expire();
        return;
      }
      const command = intent.current ?? payload;
      if (command.action !== 'preview') {
        intent.current = command;
        setPending(command);
      }
      writing.current = true;
      setBusy(true);
      setNotice('');
      setResult(null);
      const task = new AbortController();
      post.current = task;
      try {
        const response = await fetch('/api/customer-programme-participants', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'content-type': 'application/json',
            'x-corridra-customer-subject': subject,
            'x-corridra-customer-issuer': issuer,
          },
          body: JSON.stringify(command),
          signal: task.signal,
        });
        if (task.signal.aborted || !active.current) return;
        if ([401, 403].includes(response.status)) {
          deny();
          return;
        }
        if (response.status === 409) {
          intent.current = null;
          setPending(null);
          setData(null);
          setStatus('failed');
          setNotice('This request conflicts with current state. Reload before trying again.');
          return;
        }
        if (response.status === 503) {
          available.current = false;
          if (timer.current) clearTimeout(timer.current);
          setData(null);
          setStatus('unavailable');
          setNotice('Participation is unavailable. Reload before retrying an unconfirmed request.');
          return;
        }
        if ([400, 415, 422].includes(response.status)) {
          intent.current = null;
          setPending(null);
          setNotice('This request was not accepted. Check the fictional details and try again.');
          return;
        }
        if (!response.ok) throw Error('Unconfirmed participant command');
        const value = parseParticipantResult(await response.json(), command);
        if (task.signal.aborted || !active.current) return;
        if (typeof value.expiresAt === 'string') {
          deadline.current = Math.min(deadline.current, Date.parse(value.expiresAt));
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(expire, Math.max(0, deadline.current - Date.now()));
        }
        setResult({
          ...value,
          ...(command.action === 'preview' ? { requestToken: command.token } : {}),
        });
        if (command.action !== 'preview') {
          onOutcome?.(command);
          intent.current = null;
          setPending(null);
          writing.current = false;
          setNotice(
            command.action === 'invite'
              ? value.issued
                ? 'The sample invitation code is ready. No message was sent.'
                : 'The invitation already exists. Its secret cannot be recovered; revoke and reissue it.'
              : 'The programme access change is saved. Check the updated list.',
          );
          await load(undefined, undefined, true);
        }
        if (task.signal.aborted || !active.current) return;
        return value;
      } catch {
        if (!task.signal.aborted && active.current)
          setNotice(
            command.action === 'preview'
              ? 'The invitation could not be checked. Try again.'
              : 'Saving could not be confirmed. Retry the same request before changing it.',
          );
      } finally {
        if (!task.signal.aborted && active.current) {
          writing.current = false;
          setBusy(false);
        }
      }
    },
    [subject, issuer, load, deny, expire, status, onOutcome],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    const hide = () => {
      available.current = false;
      get.current?.abort();
      post.current?.abort();
      reading.current = false;
      writing.current = false;
      if (timer.current) clearTimeout(timer.current);
      setBusy(false);
      setVisible(false);
      setData(null);
      setResult(null);
      setNotice('');
      setStatus('loading');
    };
    const show = () => {
      setVisible(true);
      void load();
    };
    const visibility = () => (document.visibilityState === 'hidden' ? hide() : show());
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current = false;
      get.current?.abort();
      post.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);
  return { data, status, busy, visible, notice, pending, result, load, send };
}
