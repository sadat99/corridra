'use client';
import { object } from './pricing-client';

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
  SUBMITTED: 'Waiting for the organiser',
  WAITLISTED: 'On the waiting list',
  DECLINED: 'Declined',
  INVITED: 'Invited',
  INVITATION_EXPIRED: 'Invitation expired',
  JOINED: 'Joined',
  REGISTRATION_ENDED: 'No longer registered',
  WITHDRAWN: 'Withdrawn',
};
// The words for each named refusal. A refusal is a state the person can act on, so each says what to do next.
export const refusalWords: Record<string, string> = {
  PROGRAMME_PUBLICATION_CHANGED:
    'This page changed since you opened it. Nothing was saved. Reload to see the latest version.',
  PROGRAMME_PUBLICATION_PAUSED:
    'This programme or its workspace is archived. Restore it before publishing, inviting or joining.',
  PROGRAMME_PUBLICATION_RATE_LIMITED:
    'This page was published many times in the last hour. Wait a while, then publish again.',
  PROGRAMME_APPLICATIONS_CLOSED: 'This programme is not taking applications right now.',
  PROGRAMME_ALREADY_REGISTERED: 'This person is already registered in this programme.',
  PROGRAMME_APPLICATION_CHANGED:
    'This application changed since you opened it. Nothing was saved. Reload to see the latest.',
  PROGRAMME_APPLICATION_WITHDRAWN: 'The applicant withdrew this application.',
  PROGRAMME_APPLICATION_JOINED:
    'This applicant has already joined. Manage the registration under Participants.',
  PROGRAMME_APPLICATION_ALREADY_INVITED: 'This applicant already has an invitation they can use.',
  PROGRAMME_APPLICATION_NOT_INVITED: 'The organiser has not invited this application yet.',
  PROGRAMME_INVITATION_EXPIRED:
    'This invitation has expired. Ask the organiser to invite you again.',
  PROGRAMME_APPLICATION_LIMIT:
    'No more applications can be made to this programme from this account.',
  PROGRAMME_APPLICATION_RATE_LIMITED:
    'You made many applications in the last hour. Wait a while, then try again.',
};
export type Outcome =
  { ok: true; body: Record<string, unknown> } | { ok: false; message: string; denied: boolean };
export async function pageRequest(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<Outcome> {
  let r: Response;
  try {
    r = await fetch('/api/customer-programme-pages', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      denied: false,
      message: 'No connection. What you typed is kept. Try again when you are online.',
    };
  }
  const body: unknown = await r.json().catch(() => null);
  if (r.ok && object(body)) return { ok: true, body };
  const code = object(body) && typeof body.code === 'string' ? body.code : '';
  if (refusalWords[code]) return { ok: false, denied: false, message: refusalWords[code] };
  if (object(body) && body.code === 'archived' && typeof body.error === 'string')
    return { ok: false, denied: false, message: body.error };
  if ([401, 403].includes(r.status))
    return {
      ok: false,
      denied: true,
      message: 'Your account or workspace access changed. Reload and sign in again.',
    };
  if (r.status === 400 || r.status === 409)
    return {
      ok: false,
      denied: false,
      message: 'Some details are not valid. Check the wording and try again.',
    };
  if (r.status === 429)
    return { ok: false, denied: false, message: 'Too many requests. Wait a minute and try again.' };
  if (r.status === 503)
    return { ok: false, denied: false, message: 'Programme pages are unavailable right now.' };
  return {
    ok: false,
    denied: false,
    message: 'It could not be saved. What you typed is kept. Try again.',
  };
}
export const shortDay = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
