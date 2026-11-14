import { pp } from '../../../lib/i18n/programme-pages';
import type { Application, ApplicationStatus } from './programme-page-client';

// The organiser's answers to an application, in one place. The public page panel (programme-page.tsx) and the people
// board (programme-people-board.tsx, ADR-084 S3) both ask this module which answers an application offers, what each
// is called, what a decline needs and what is sent, so the two screens cannot drift apart. Nothing here sends a
// request: callers pass the payload to pageRequest, as before.
export type Decision = 'INVITED' | 'WAITLISTED' | 'DECLINED';

/** The statuses an organiser can still answer. A joined, ended or withdrawn application offers no answer. */
export const answerableStatuses: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'WAITLISTED',
  'DECLINED',
  'INVITED',
  'INVITATION_EXPIRED',
];
/** The statuses from which an application can be put on the waiting list. */
export const waitlistableStatuses: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'DECLINED',
  'INVITATION_EXPIRED',
];
/** The length a decline reason must have, in characters, after trimming. */
export const declineReasonLength = { min: 10, max: 500 } as const;

/** The answers an application offers, in the order they are shown. */
export function decisionsFor(status: ApplicationStatus): Decision[] {
  if (!answerableStatuses.includes(status)) return [];
  const out: Decision[] = [];
  if (status !== 'INVITED') out.push('INVITED');
  if (waitlistableStatuses.includes(status)) out.push('WAITLISTED');
  if (status !== 'DECLINED') out.push('DECLINED');
  return out;
}

/** The words on the button for one answer. */
export function decisionLabel(decision: Decision, status: ApplicationStatus): string {
  if (decision === 'WAITLISTED') return pp('pp.org.waitlist');
  if (decision === 'DECLINED') return pp('pp.org.decline');
  return status === 'INVITATION_EXPIRED' ? pp('pp.org.inviteAgain') : pp('pp.org.invite');
}

/** Only a decline carries a note, the trimmed reason the applicant will read. */
export function decisionNote(decision: Decision, reason: string): string {
  return decision === 'DECLINED' ? reason.trim() : '';
}

/** The refusal to show before anything is sent, or null when the answer can go. */
export function decisionProblem(decision: Decision, note: string): string | null {
  if (decision !== 'DECLINED') return null;
  const length = [...note.trim()].length;
  return length >= declineReasonLength.min && length <= declineReasonLength.max
    ? null
    : pp('pp.org.declineReasonNeeded');
}

/** The text a command id is derived from, so a retry of the same answer keeps its id. */
export function decisionIntent(item: Application, decision: Decision, note: string): string {
  return 'decide' + item.id + item.decisionVersion + decision + note;
}

/** The command sent for one answer. The same payload, in the same order, on both screens. */
export function decisionPayload(
  scope: { workspaceId: string; programmeId: string },
  item: Application,
  decision: Decision,
  note: string,
  forIntent: (intent: string) => string,
): Record<string, unknown> {
  return {
    kind: 'application',
    action: 'decide',
    commandId: forIntent(decisionIntent(item, decision, note)),
    workspaceId: scope.workspaceId,
    programmeId: scope.programmeId,
    applicationId: item.id,
    expectedVersion: item.decisionVersion,
    decision,
    ...(note ? { note } : {}),
    acknowledged: true,
  };
}
