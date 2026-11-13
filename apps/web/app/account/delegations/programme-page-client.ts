'use client';
import { useEffect, useState } from 'react';
import { pp } from '../../../lib/i18n/programme-pages';
import { customerHeaders, object } from './pricing-client';

// Browser helpers for the programme page and applications (ADR-080). Nothing here decides authority: the database
// checks every request again.
export type Activity = { label: string; status: 'PLANNED' | 'CONFIRMED' };
export type PublicCopy = {
  title: string;
  organiser: string;
  summary: string;
  destination: string;
  dates: string;
  focus: string;
  audience: string;
  eligibility: string;
  activities: Activity[];
  included: string[];
  excluded: string[];
  fee?: string;
  capacity?: number;
};
export type PageState = 'NONE' | 'OPEN' | 'CLOSED' | 'ENDED' | 'WITHDRAWN' | 'PAUSED';
export type PageView = {
  version: number;
  state: PageState;
  address?: string;
  copy?: PublicCopy;
  closesAt?: string;
  applications: number;
  awaiting: number;
  sample: boolean;
};
export type ApplicationStatus =
  | 'SUBMITTED'
  | 'WAITLISTED'
  | 'DECLINED'
  | 'INVITED'
  | 'INVITATION_EXPIRED'
  | 'JOINED'
  | 'REGISTRATION_ENDED'
  | 'WITHDRAWN';
export type Application = {
  id: string;
  status: ApplicationStatus;
  displayLabel: string;
  statement: string;
  appliedAt: string;
  decisionVersion: number;
  note?: string;
  invitationExpiresAt?: string;
  registrationId?: string;
  address?: string;
  title?: string;
};
const statuses: readonly string[] = [
  'SUBMITTED',
  'WAITLISTED',
  'DECLINED',
  'INVITED',
  'INVITATION_EXPIRED',
  'JOINED',
  'REGISTRATION_ENDED',
  'WITHDRAWN',
];
const states: readonly string[] = ['NONE', 'OPEN', 'CLOSED', 'ENDED', 'WITHDRAWN', 'PAUSED'];
export function parseApplication(v: unknown): Application {
  if (
    !object(v) ||
    typeof v.id !== 'string' ||
    typeof v.status !== 'string' ||
    !statuses.includes(v.status) ||
    typeof v.displayLabel !== 'string' ||
    typeof v.statement !== 'string' ||
    typeof v.appliedAt !== 'string' ||
    typeof v.decisionVersion !== 'number'
  )
    throw Error('Unexpected application');
  return v as unknown as Application;
}
export function parsePageView(v: unknown): PageView {
  if (
    !object(v) ||
    typeof v.version !== 'number' ||
    typeof v.state !== 'string' ||
    !states.includes(v.state) ||
    typeof v.applications !== 'number' ||
    typeof v.awaiting !== 'number' ||
    typeof v.sample !== 'boolean'
  )
    throw Error('Unexpected programme page');
  return v as unknown as PageView;
}
export const statusWords: Record<ApplicationStatus, string> = {
  SUBMITTED: pp('pp.status.SUBMITTED'),
  WAITLISTED: pp('pp.status.WAITLISTED'),
  DECLINED: pp('pp.status.DECLINED'),
  INVITED: pp('pp.status.INVITED'),
  INVITATION_EXPIRED: pp('pp.status.INVITATION_EXPIRED'),
  JOINED: pp('pp.status.JOINED'),
  REGISTRATION_ENDED: pp('pp.status.REGISTRATION_ENDED'),
  WITHDRAWN: pp('pp.status.WITHDRAWN'),
};
// The words for each named refusal. A refusal is a state the person can act on, so each says what to do next.
export const refusalWords: Record<string, string> = {
  PROGRAMME_PUBLICATION_CHANGED: pp('pp.refusal.PROGRAMME_PUBLICATION_CHANGED'),
  PROGRAMME_PUBLICATION_PAUSED: pp('pp.refusal.PROGRAMME_PUBLICATION_PAUSED'),
  PROGRAMME_PUBLICATION_RATE_LIMITED: pp('pp.refusal.PROGRAMME_PUBLICATION_RATE_LIMITED'),
  PROGRAMME_APPLICATIONS_CLOSED: pp('pp.refusal.PROGRAMME_APPLICATIONS_CLOSED'),
  PROGRAMME_ALREADY_REGISTERED: pp('pp.refusal.PROGRAMME_ALREADY_REGISTERED'),
  PROGRAMME_APPLICATION_CHANGED: pp('pp.refusal.PROGRAMME_APPLICATION_CHANGED'),
  PROGRAMME_APPLICATION_WITHDRAWN: pp('pp.refusal.PROGRAMME_APPLICATION_WITHDRAWN'),
  PROGRAMME_APPLICATION_JOINED: pp('pp.refusal.PROGRAMME_APPLICATION_JOINED'),
  PROGRAMME_APPLICATION_ALREADY_INVITED: pp('pp.refusal.PROGRAMME_APPLICATION_ALREADY_INVITED'),
  PROGRAMME_APPLICATION_NOT_INVITED: pp('pp.refusal.PROGRAMME_APPLICATION_NOT_INVITED'),
  PROGRAMME_INVITATION_EXPIRED: pp('pp.refusal.PROGRAMME_INVITATION_EXPIRED'),
  PROGRAMME_APPLICATION_LIMIT: pp('pp.refusal.PROGRAMME_APPLICATION_LIMIT'),
  PROGRAMME_APPLICATION_RATE_LIMITED: pp('pp.refusal.PROGRAMME_APPLICATION_RATE_LIMITED'),
};
export type Outcome =
  { ok: true; body: Record<string, unknown> } | { ok: false; message: string; denied: boolean };
// Every write names the signed-in person here, where it is sent: the server refuses a request whose identity is not the
// current session's.
export async function pageRequest(
  identity: { subject: string; issuer: string },
  payload: Record<string, unknown>,
): Promise<Outcome> {
  let r: Response;
  try {
    r = await fetch('/api/customer-programme-pages', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...customerHeaders(identity.subject, identity.issuer),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, denied: false, message: pp('pp.error.offline') };
  }
  const body: unknown = await r.json().catch(() => null);
  if (r.ok && object(body)) return { ok: true, body };
  const code = object(body) && typeof body.code === 'string' ? body.code : '';
  if (refusalWords[code]) return { ok: false, denied: false, message: refusalWords[code] };
  if (object(body) && body.code === 'archived' && typeof body.error === 'string')
    return { ok: false, denied: false, message: body.error };
  if ([401, 403].includes(r.status))
    return { ok: false, denied: true, message: pp('pp.error.denied') };
  if (r.status === 400 || r.status === 409)
    return { ok: false, denied: false, message: pp('pp.error.invalid') };
  if (r.status === 429) return { ok: false, denied: false, message: pp('pp.error.tooMany') };
  if (r.status === 503) return { ok: false, denied: false, message: pp('pp.error.unavailable') };
  return { ok: false, denied: false, message: pp('pp.error.notSaved') };
}
export const shortDay = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

// The two application counts of the organiser's own page read (existing GET, nothing new). Counts only; null while
// unread, where pages are off for this programme, or when the read fails.
export function useApplicationCounts(
  scope: { subject: string; issuer: string; workspaceId?: string; programmeId?: string },
  on: boolean,
  reads: number,
): { applications: number; awaiting: number } | null {
  const { subject, issuer, workspaceId, programmeId } = scope;
  const key = `${workspaceId}:${programmeId}:${reads}`;
  const [state, setState] = useState<{
    key: string;
    counts: { applications: number; awaiting: number } | null;
  }>({
    key: '',
    counts: null,
  });
  useEffect(() => {
    if (!on || !workspaceId || !programmeId) return;
    const task = new AbortController();
    void Promise.resolve().then(async () => {
      let counts: { applications: number; awaiting: number } | null = null;
      try {
        const r = await fetch(
          `/api/customer-programme-pages?view=page&workspaceId=${workspaceId}&programmeId=${programmeId}`,
          {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: customerHeaders(subject, issuer),
            signal: task.signal,
          },
        );
        if (r.ok) {
          const view = parsePageView(await r.json());
          counts = { applications: view.applications, awaiting: view.awaiting };
        }
      } catch {
        counts = null;
      }
      if (!task.signal.aborted) setState({ key, counts });
    });
    return () => task.abort();
  }, [on, subject, issuer, workspaceId, programmeId, key]);
  // A refresh keeps the last counts on screen until the new read settles.
  return on && state.key.startsWith(`${workspaceId}:${programmeId}:`) ? state.counts : null;
}
