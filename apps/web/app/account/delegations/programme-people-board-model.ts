import type { Invitation, Registration } from './participant-client';
import type { Application, ApplicationStatus } from './programme-page-client';

// ADR-084 slice S3 (CORRIDRA_DELEGATION_BOARD): the people board. Pure ordering over records the organiser already
// reads: applications, code invitations and consented registrations. Nothing here estimates, joins people across
// records or infers a state. A record keeps the state it was given: an application is not a place, and a
// registration is not a paid or confirmed attendance.

export type BoardGroup = 'decide' | 'waiting' | 'waitlisted' | 'in' | 'closed';
export type BoardRow =
  | { key: string; kind: 'application'; group: BoardGroup; label: string; application: Application }
  | { key: string; kind: 'invitation'; group: BoardGroup; label: string; invitation: Invitation }
  | {
      key: string;
      kind: 'registration';
      group: BoardGroup;
      label: string;
      registration: Registration;
    };

const applicationGroup: Record<ApplicationStatus, BoardGroup> = {
  SUBMITTED: 'decide',
  INVITED: 'waiting',
  WAITLISTED: 'waitlisted',
  JOINED: 'in',
  DECLINED: 'closed',
  INVITATION_EXPIRED: 'closed',
  REGISTRATION_ENDED: 'closed',
  WITHDRAWN: 'closed',
};
const order: Record<BoardGroup, number> = {
  decide: 0,
  waiting: 1,
  waitlisted: 2,
  in: 3,
  closed: 4,
};

const time = (iso: string | undefined) => {
  const value = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

/**
 * One list, the next decision first. Applications waiting for an answer come first, oldest first, because a person
 * has waited longest; then people who were invited and have not joined, soonest expiry first; then the waiting
 * list; then who is in. Everything ended or refused comes last. A JOINED application whose registration is among
 * the records read is shown once, as the registration (the registration id the application already carries).
 */
export function boardRows(
  applications: readonly Application[],
  invitations: readonly Invitation[],
  registrations: readonly Registration[],
): BoardRow[] {
  const known = new Set(registrations.map((r) => r.id));
  const rows: BoardRow[] = [];
  for (const application of applications) {
    if (
      application.status === 'JOINED' &&
      application.registrationId &&
      known.has(application.registrationId)
    )
      continue;
    rows.push({
      key: 'a:' + application.id,
      kind: 'application',
      group: applicationGroup[application.status],
      label: application.displayLabel,
      application,
    });
  }
  for (const invitation of invitations)
    rows.push({
      key: 'i:' + invitation.id,
      kind: 'invitation',
      group: invitation.status === 'ISSUED' ? 'waiting' : 'closed',
      label: invitation.label,
      invitation,
    });
  for (const registration of registrations)
    rows.push({
      key: 'r:' + registration.id,
      kind: 'registration',
      group: registration.status === 'REGISTERED' ? 'in' : 'closed',
      label: registration.displayLabel ?? 'Participant',
      registration,
    });
  const when = (row: BoardRow) =>
    row.kind === 'application'
      ? row.group === 'waiting'
        ? time(row.application.invitationExpiresAt)
        : time(row.application.appliedAt)
      : row.kind === 'invitation'
        ? time(row.invitation.expiresAt)
        : time(row.registration.consentedAt);
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        order[a.row.group] - order[b.row.group] || when(a.row) - when(b.row) || a.index - b.index,
    )
    .map(({ row }) => row);
}

/** How many rows show before "Show more". Applications waiting come first, so the next decision is always in view. */
export const boardVisible = 5;

/** Counts of what was read, never a total that was not read. */
export function boardCounts(rows: readonly BoardRow[]) {
  const n = (group: BoardGroup) => rows.filter((row) => row.group === group).length;
  return {
    decide: n('decide'),
    waiting: n('waiting'),
    waitlisted: n('waitlisted'),
    in: n('in'),
    closed: n('closed'),
  };
}

/** What one read of the board's records says: not asked, in flight, read, refused or failed, or not available. */
export type ReadState = 'none' | 'loading' | 'ready' | 'failed' | 'unavailable';
/** The two reads the board draws on. `people` is the participants read (invitations, registrations). */
export type BoardReads = { applications: ReadState; people: ReadState };

/**
 * The line above the list: the next decision, or the plain fact that nothing is waiting. It says only what was read.
 * While the applications are unread, failed or unavailable it makes no claim about them, and while the participants
 * are unread it makes no claim about invitations or registrations; with nothing read it says nothing (null).
 * `none` means the programme has no list of that kind to read, so it counts as read and empty.
 */
export function boardLead(
  rows: readonly BoardRow[],
  partial: boolean,
  reads: BoardReads = { applications: 'ready', people: 'ready' },
): string | null {
  const applications = reads.applications === 'ready' || reads.applications === 'none';
  const people = reads.people === 'ready';
  if ((!applications && !people) || (reads.applications === 'none' && !people)) return null;
  const counts = boardCounts(rows);
  const more = partial ? ' read so far' : '';
  if (applications && counts.decide > 0) {
    const first = rows[0]!;
    return `${counts.decide} ${counts.decide === 1 ? 'application is' : 'applications are'} waiting for your answer${more}. Next: ${first.label}.`;
  }
  const invited = `${counts.waiting} ${counts.waiting === 1 ? 'person has' : 'people have'} been invited and ${counts.waiting === 1 ? 'has' : 'have'} not joined yet${more}.`;
  if (applications && people) {
    if (rows.length === 0) return 'No applications, invitations or registrations yet.';
    if (counts.waiting > 0) return `Nothing is waiting for your answer. ${invited}`;
    return `Nothing is waiting for your answer${more}.`;
  }
  if (applications) {
    // Applications read, invitations and registrations not: say only the applications.
    return rows.length === 0
      ? 'No applications yet.'
      : `No applications are waiting for your answer${more}.`;
  }
  // Invitations and registrations read, applications not: say only who was invited.
  return counts.waiting > 0 ? invited : null;
}
