import type {
  OwnPlace,
  PlacesReport,
  Reminders,
  TermsState,
} from '@corridra/auth/customer-programme-terms';

// Shared helpers for the terms, eligibility, places and reminders screens.
export type TermsFailure = 'denied' | 'unavailable' | 'failed';
export const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e7;
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= max;
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const placeStatuses = [
  'NOT_APPLIED',
  'PLACED',
  'WAITLISTED',
  'NOT_ELIGIBLE',
  'CANCELLED',
] as const;
export const reasonCodes = ['NO_PROFILE', 'ROLE', 'SECTOR', 'COUNTRY', 'SIZE', 'COMPLETENESS'];

// What the participant reads when a rule is not met. Codes only come from the database, never profile content.
export const participantReason: Record<string, string> = {
  NO_PROFILE:
    'We could not find an organisation profile for the workspace you chose. Add one in your account, then apply again.',
  ROLE: "Your organisation's commercial role is not one this programme accepts.",
  SECTOR: "Your organisation's sectors do not match the sectors this programme accepts.",
  COUNTRY: "Your organisation's country is not one this programme accepts.",
  SIZE: "Your organisation's size is outside what this programme accepts.",
  COMPLETENESS:
    'Your organisation profile has fewer details filled in than this programme asks for.',
};
// What the organiser reads. It names the rule that was not met and nothing from the profile.
export const organiserReason: Record<string, string> = {
  NO_PROFILE: 'No organisation profile was available',
  ROLE: 'Commercial role does not match',
  SECTOR: 'Sectors do not match',
  COUNTRY: 'Country does not match',
  SIZE: 'Company size does not match',
  COMPLETENESS: 'Profile has too few details filled in',
};
export const statusLabel: Record<string, string> = {
  NOT_APPLIED: 'Has not applied yet',
  PLACED: 'Has a place',
  WAITLISTED: 'On the waiting list',
  NOT_ELIGIBLE: 'Not eligible',
  CANCELLED: 'Gave up the place',
};
export const roleLabel: Record<string, string> = {
  BUYER: 'Buyer',
  SELLER: 'Seller',
  SUPPLIER: 'Supplier',
  MANUFACTURER: 'Manufacturer',
  DISTRIBUTOR: 'Distributor',
  ORGANISER: 'Organiser',
};
// One decimal from an exact integer permille, with no floating point.
export function percent(permille: number | null) {
  if (permille === null) return 'not available';
  return Math.floor(permille / 10) + '.' + (permille % 10) + '%';
}
export function money(minor: string, exponent: number) {
  if (exponent <= 0) return minor;
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(exponent + 1, '0');
  return (negative ? '-' : '') + digits.slice(0, -exponent) + '.' + digits.slice(-exponent);
}

function terms(v: unknown) {
  return (
    object(v) &&
    count(v.version) &&
    text(v.included, 1000) &&
    text(v.cancellationTerms, 1000) &&
    text(v.changeTerms, 1000) &&
    typeof v.feesApply === 'boolean' &&
    (v.excluded === null || text(v.excluded, 1000)) &&
    (v.feeNote === null || text(v.feeNote, 500))
  );
}
function criteria(v: unknown) {
  return (
    object(v) &&
    count(v.version) &&
    [v.roles, v.sectors, v.countries, v.sizeBands].every(
      (a) => Array.isArray(a) && a.length <= 30 && a.every((s) => text(s, 60)),
    ) &&
    count(v.minProfileFields)
  );
}
export function parseState(v: unknown, workspaceId: string, programmeId: string): TermsState {
  if (
    !object(v) ||
    v.workspaceId !== workspaceId ||
    v.programmeId !== programmeId ||
    v.sendsMessages !== false ||
    !object(v.terms) ||
    !object(v.eligibility) ||
    !object(v.places) ||
    !Array.isArray(v.tasks) ||
    v.tasks.length > 200 ||
    !Array.isArray(v.members) ||
    v.members.length > 500 ||
    typeof v.expiresAt !== 'string'
  )
    throw Error('Invalid state');
  const t = v.terms,
    e = v.eligibility,
    p = v.places;
  if (
    !(t.current === null || terms(t.current)) ||
    !Array.isArray(t.history) ||
    !t.history.every(terms) ||
    !(e.current === null || criteria(e.current)) ||
    !Array.isArray(e.history) ||
    !e.history.every(criteria) ||
    !count(p.version) ||
    !(p.minimum === null || count(p.minimum)) ||
    !(p.maximum === null || count(p.maximum)) ||
    typeof p.waitlist !== 'boolean' ||
    !count(p.placed)
  )
    throw Error('Invalid state figures');
  for (const task of v.tasks)
    if (
      !object(task) ||
      !uuid(task.id) ||
      !count(task.seq) ||
      !count(task.version) ||
      !text(task.title, 160) ||
      !(task.dueOn === null || day(task.dueOn)) ||
      !object(task.plan) ||
      !count(task.plan.version) ||
      !(task.plan.assigneeKey === null || uuid(task.plan.assigneeKey)) ||
      typeof task.plan.participantVisible !== 'boolean'
    )
      throw Error('Invalid task');
  for (const m of v.members)
    if (!object(m) || !uuid(m.key) || !text(m.label, 200) || typeof m.isYou !== 'boolean')
      throw Error('Invalid member');
  return v as unknown as TermsState;
}
export function parseReport(v: unknown, workspaceId: string, programmeId: string): PlacesReport {
  if (
    !object(v) ||
    v.workspaceId !== workspaceId ||
    v.programmeId !== programmeId ||
    v.verified !== false ||
    v.sendsMessages !== false ||
    !object(v.places) ||
    !object(v.funnel) ||
    !object(v.eligibility) ||
    !object(v.terms) ||
    !object(v.satisfaction) ||
    !object(v.outcomes) ||
    !Array.isArray(v.roster) ||
    v.roster.length > 500
  )
    throw Error('Invalid report');
  const { places, funnel, terms: tm, satisfaction } = v;
  if (
    !count(places.placed) ||
    !count(places.waiting) ||
    !count(places.promotable) ||
    !(places.maximum === null || count(places.maximum)) ||
    !(places.minimum === null || count(places.minimum)) ||
    !(places.fillPermille === null || count(places.fillPermille)) ||
    !Object.values(funnel).every(count) ||
    !count(tm.version) ||
    !count(tm.acceptedCurrent) ||
    !(tm.acceptanceRatePermille === null || count(tm.acceptanceRatePermille)) ||
    !count(satisfaction.ratingCount) ||
    !count(satisfaction.ratingSum)
  )
    throw Error('Invalid report figures');
  for (const r of v.roster)
    if (
      !object(r) ||
      !uuid(r.registrationId) ||
      !text(r.label, 200) ||
      !placeStatuses.includes(r.status as never) ||
      !Array.isArray(r.reasons) ||
      !r.reasons.every((c) => reasonCodes.includes(c as string))
    )
      throw Error('Invalid roster');
  return v as unknown as PlacesReport;
}
export function parseOwnPlace(v: unknown, registrationId: string): OwnPlace {
  if (
    !object(v) ||
    v.registrationId !== registrationId ||
    v.sendsMessages !== false ||
    typeof v.expiresAt !== 'string' ||
    !(v.terms === null || terms(v.terms)) ||
    !(v.criteria === null || criteria(v.criteria)) ||
    !object(v.enrolment) ||
    !placeStatuses.includes(v.enrolment.status as never) ||
    !(v.enrolment.position === null || count(v.enrolment.position)) ||
    !Array.isArray(v.enrolment.reasons) ||
    !v.enrolment.reasons.every((c) => reasonCodes.includes(c as string)) ||
    typeof v.placesAvailable !== 'boolean' ||
    typeof v.waitlist !== 'boolean' ||
    !Array.isArray(v.fees) ||
    !Array.isArray(v.tasks) ||
    !Array.isArray(v.profileChoices) ||
    v.profileChoices.length > 100
  )
    throw Error('Invalid place');
  for (const fee of v.fees)
    if (
      !object(fee) ||
      !/^[A-Z]{3}$/.test(String(fee.currency)) ||
      !count(fee.exponent) ||
      !/^-?[0-9]{1,19}$/.test(String(fee.dueMinor))
    )
      throw Error('Invalid fee');
  for (const t of v.tasks)
    if (!object(t) || !text(t.title, 160) || !(t.dueOn === null || day(t.dueOn)))
      throw Error('Invalid task');
  for (const c of v.profileChoices)
    if (
      !object(c) ||
      !uuid(c.workspaceId) ||
      !text(c.name, 200) ||
      typeof c.hasProfile !== 'boolean'
    )
      throw Error('Invalid choice');
  return v as unknown as OwnPlace;
}
export function parseReminders(v: unknown): Reminders {
  if (
    !object(v) ||
    v.sendsMessages !== false ||
    !day(v.asOf) ||
    typeof v.expiresAt !== 'string' ||
    !Array.isArray(v.assignedToYou) ||
    !Array.isArray(v.forParticipant) ||
    !Array.isArray(v.termsToAccept) ||
    v.assignedToYou.length > 100 ||
    v.forParticipant.length > 100 ||
    v.termsToAccept.length > 100
  )
    throw Error('Invalid reminders');
  for (const t of v.assignedToYou)
    if (
      !object(t) ||
      !uuid(t.workspaceId) ||
      !uuid(t.programmeId) ||
      !uuid(t.taskId) ||
      !count(t.version) ||
      !text(t.title, 160) ||
      !day(t.dueOn) ||
      !['OVERDUE', 'DUE_SOON'].includes(String(t.state))
    )
      throw Error('Invalid reminder');
  for (const t of v.forParticipant)
    if (
      !object(t) ||
      !text(t.title, 160) ||
      !day(t.dueOn) ||
      !['OVERDUE', 'DUE_SOON'].includes(String(t.state))
    )
      throw Error('Invalid reminder');
  for (const t of v.termsToAccept)
    if (!object(t) || !uuid(t.registrationId) || !count(t.version)) throw Error('Invalid reminder');
  return v as unknown as Reminders;
}

// One request to the terms route. The command id stays the same while the same content is retried.
export type Api = {
  get: (query: Record<string, string>, signal?: AbortSignal) => Promise<unknown>;
  post: (action: string, input: Record<string, unknown>) => Promise<unknown>;
};
export class TermsError extends Error {
  constructor(
    readonly kind: TermsFailure | 'conflict' | 'invalid' | 'retry',
    message: string,
  ) {
    super(message);
  }
}
export function termsApi(subject: string, issuer: string): Api {
  const headers = { 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer };
  async function settle(r: Response) {
    const body: unknown = await r.json().catch(() => null);
    const changed =
      r.status === 409 &&
      object(body) &&
      typeof body.error === 'string' &&
      body.error.includes('account changed');
    if ([401, 403].includes(r.status) || changed) throw new TermsError('denied', 'Access changed');
    if (r.status === 503) throw new TermsError('unavailable', 'Unavailable');
    if (r.status === 409) throw new TermsError('conflict', 'Conflict');
    if (r.status === 400) throw new TermsError('invalid', 'Invalid');
    if (!r.ok) throw new TermsError('failed', 'Failed');
    return body;
  }
  return {
    async get(query, signal) {
      return settle(
        await fetch('/api/customer-programme-terms?' + new URLSearchParams(query), {
          cache: 'no-store',
          credentials: 'same-origin',
          headers,
          signal,
        }),
      );
    },
    async post(action, input) {
      let r: Response;
      try {
        r = await fetch('/api/customer-programme-terms', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ action, input }),
        });
      } catch {
        throw new TermsError('retry', 'Not confirmed');
      }
      return settle(r);
    },
  };
}
export function failureText(e: unknown) {
  if (e instanceof TermsError) {
    if (e.kind === 'conflict')
      return 'This changed since you opened it, or it is not allowed right now. Reload to see the latest, then try again.';
    if (e.kind === 'invalid') return 'Some details are not valid. Check the wording and numbers.';
    if (e.kind === 'retry') return 'It could not be confirmed. What you typed is kept; try again.';
  }
  return 'It could not be saved. What you typed is kept; try again.';
}
export const syntheticOk = (v: string) => /^Synthetic .{3,}/.test(v.trim());
