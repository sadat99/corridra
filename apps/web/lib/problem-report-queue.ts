import {
  oneLine,
  plainTextAllowed,
  problemReportLimits,
  type ProblemReportStatus,
  type ProblemReporterKind,
} from '@corridra/domain/problem-report';
import type {
  ProblemReportMoved,
  ProblemReportQueue,
  ProblemReportWordsRemoved,
} from '@corridra/auth/problem-reports';
import { whenWords } from '../app/account/workspace-lifecycle-client';
import { limitWords } from './account-limit';
import { failureWords, formWords, statusLabels } from './problem-report-words';
import { ActionError, isStepUpRequired, readJson, withStepUp } from './ux/step-up';

// The staff queue of problem reports (docs/revamp/specs/problem-reports.md section 6, ADR-078) and the owner's removal of
// the words under an erasure request. The screens hold no rule of their own: the server and the database decide who may
// move a report and which move is allowed, so a refusal is only told, in words that say what to do next. Every call that
// the server may ask a fresh authenticator check for goes through withStepUp, which keeps the page (and the note) as it is.

export const queuePageSize = 10;
/** The address of the panel inside Settings (#problem-report-queue). */
export const problemReportQueueFragment = 'problem-report-queue';
const route = '/api/workspace/problem-reports';

/** Only an owner or an admin sees the queue and moves a report; the server decides again with the membership. */
export const canTriage = (role: string | null | undefined) => role === 'owner' || role === 'admin';
/** Only an owner removes the words under an erasure request (members.manage); the server decides again. */
export const canRemoveWords = (role: string | null | undefined) => role === 'owner';

export type QueueFilter = 'all' | ProblemReportStatus;
export const reporterKindLabels: Record<ProblemReporterKind, string> = {
  customer: 'Customer',
  team: 'Team member',
};

export const ageWords = (days: number) =>
  days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;

export const queueWords = {
  title: 'Problem reports',
  intro:
    'Customers and team members report problems with Corridra here. Move each one when you start work on it, and again when it is resolved or closed.',
  filterLabel: 'Show',
  filterAll: 'All',
  load: 'Load Problem Reports',
  loadMore: 'Load More Problem Reports',
  loading: 'Loading…',
  chooseLoad: 'Choose Load Problem Reports to show this selection.',
  empty: 'No problem reports to show.',
  loadFailed: 'Problem reports could not be loaded. Check your connection and try again.',
  showDetails: 'Show Details and History',
  where: 'Where',
  details: 'Details',
  history: 'History',
  nothingAdded: 'Nothing added.',
  wordsGone: 'The words of this problem report were removed.',
  noteLabel: 'Note to the reporter',
  noteHint: "Do not copy a reporter's words into a note; notes stay after the words are removed.",
  caution: 'The reporter will read this note. You cannot change or delete it after you save.',
  save: 'Save',
  saving: 'Saving…',
  cancel: 'Cancel',
  reload: 'Reload',
  reloading: 'Reloading…',
  noteRequired: 'Required',
  noteOptional: 'Optional',
  noteLength: 'Write 10 to 1000 characters for the reporter.',
  noteLengthOptional: 'Write 10 to 1000 characters for the reporter, or leave this empty.',
  forbidden: 'This role cannot manage problem reports.',
  changed: 'This problem report has changed. Reload and try again.',
  notFound: 'This problem report was not found. Reload and try again.',
  unavailable: failureWords.unavailable,
  moveFailed:
    'The problem report was not changed. Check your connection and try again. Your note is kept.',
  invalid: 'The note was not accepted. Check it, then try again. Your note is kept.',
  signedOut: failureWords.signedOutAgain,
  moved: (reference: string, status: ProblemReportStatus) =>
    `Problem report ${reference} is now ${statusLabels[status]}.`,
  movedNotReloaded: (reference: string, status: ProblemReportStatus, reason: string) =>
    `Problem report ${reference} is now ${statusLabels[status]}, but the list could not be reloaded. ${reason}`,
  movedOn: (status: ProblemReportStatus) =>
    `This problem report is now ${statusLabels[status]}. Choose its next step. Your note is kept.`,
  gone: 'This problem report is no longer in this list. Your note was not saved.',
  summary: (shown: number, total: number) =>
    `Showing ${shown} of ${total} problem report${total === 1 ? '' : 's'}.`,
  waiting: (received: number, total: number) => `${received} of ${total} waiting`,
  oldest: (filedAt: string, days: number) =>
    `Oldest waiting: filed ${whenWords(filedAt).replace(/ UTC$/, ' (UTC)')}, ${ageWords(days)}.`,
  noneWaiting: 'No problem report is waiting in Received.',
  oldestUnknown: 'Oldest waiting: Not measured yet.',
} as const;

const wholeDaysSince = (iso: string, now: Date) =>
  Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));

/** The "Oldest waiting" line: a date and an age, or why there is none. Nothing is guessed. */
export function oldestWaitingLine(queue: ProblemReportQueue, now: Date = new Date()) {
  if (queue.oldestReceivedAt)
    return queueWords.oldest(queue.oldestReceivedAt, wholeDaysSince(queue.oldestReceivedAt, now));
  return queue.counts.received === 0 ? queueWords.noneWaiting : queueWords.oldestUnknown;
}
/** Every problem report in the workspace, whatever the filter: the figure "waiting" is counted out of. */
export const queueTotal = (counts: ProblemReportQueue['counts']) =>
  counts.received + counts.in_review + counts.resolved + counts.closed;

/** The moves the database allows, by the status a report has now. The note is required where the server requires it. */
export type Move = {
  to: 'in_review' | 'resolved' | 'closed';
  label: string;
  noteRequired: boolean;
};
export const movesFrom = (status: ProblemReportStatus): Move[] =>
  status === 'received'
    ? [
        { to: 'in_review', label: 'Start Review', noteRequired: false },
        { to: 'closed', label: 'Mark Closed', noteRequired: true },
      ]
    : status === 'in_review'
      ? [
          { to: 'resolved', label: 'Mark Resolved', noteRequired: true },
          { to: 'closed', label: 'Mark Closed', noteRequired: true },
        ]
      : [];

/** What a note needs before it is sent, the domain's own rule; null means it may go. The note kept is the one-line form. */
export function noteProblem(note: string, required: boolean): string | null {
  const text = oneLine(note);
  const length = [...text].length;
  if (length === 0 && !required) return null;
  const { min, max } = problemReportLimits.note;
  if (length < min || length > max)
    return required ? queueWords.noteLength : queueWords.noteLengthOptional;
  return plainTextAllowed(text) ? null : formWords.errorPlain;
}

export type QueueFailure = {
  message: string;
  /** Reading the list again is the way forward (the report changed under the person). */
  reload: boolean;
  /** Signing in again is the way forward. */
  signIn: boolean;
};
type Doing = 'load' | 'move' | 'remove';

const removeWords = {
  forbidden: 'Only an owner can remove words under an erasure request.',
  changed: 'That request changed or is not in this queue. Reload the list.',
  failed: 'The words were not removed. Check your connection and try again.',
} as const;

/**
 * What to say for a failed call, by status. A refusal that asks for a fresh authenticator check is said in the words
 * withStepUp gives (the dialog was closed; nothing was lost, and the same button tries again). Network failures and every
 * other 5xx say nothing of the server.
 */
export function queueFailure(error: unknown, doing: Doing): QueueFailure {
  const say = (message: string, extra: Partial<QueueFailure> = {}): QueueFailure => ({
    message,
    reload: false,
    signIn: false,
    ...extra,
  });
  if (isStepUpRequired(error)) return say((error as ActionError).message);
  if (!(error instanceof ActionError))
    return say(
      doing === 'load'
        ? queueWords.loadFailed
        : doing === 'move'
          ? queueWords.moveFailed
          : removeWords.failed,
    );
  const { status } = error;
  if (status === 401) return say(queueWords.signedOut, { signIn: true });
  if (status === 403) return say(doing === 'remove' ? removeWords.forbidden : queueWords.forbidden);
  if (status === 429) return say(limitWords);
  if (status === 503) return say(queueWords.unavailable);
  if (status === 400) return say(queueWords.invalid);
  if (status === 404 || status === 409) {
    if (doing === 'remove') return say(removeWords.changed);
    return say(status === 409 ? queueWords.changed : queueWords.notFound, { reload: true });
  }
  return say(
    doing === 'load'
      ? queueWords.loadFailed
      : doing === 'move'
        ? queueWords.moveFailed
        : removeWords.failed,
  );
}

type Fetcher = typeof fetch;
const url = (tenant: string, params: Record<string, string> = {}) =>
  `${route}?${new URLSearchParams({ tenant, ...params }).toString()}`;
const post = (body: object): RequestInit => ({
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
// An answer that is not the shape the screen draws is no answer: it is said like any other failure to read.
const notAnAnswer = () => new ActionError(queueWords.loadFailed, 502);

/** One page of the queue (oldest first), for one status or all. Asks for a fresh authenticator check when the server does. */
export async function readQueue(
  tenant: string,
  filter: QueueFilter,
  afterNumber: number | null,
  fetcher: Fetcher = fetch,
): Promise<ProblemReportQueue> {
  const params: Record<string, string> = { view: 'queue', pageSize: String(queuePageSize) };
  if (filter !== 'all') params.status = filter;
  if (afterNumber !== null) params.afterNumber = String(afterNumber);
  const queue = await withStepUp(async () =>
    readJson<ProblemReportQueue>(
      await fetcher(url(tenant, params), { cache: 'no-store', credentials: 'same-origin' }),
    ),
  );
  if (
    !Array.isArray(queue?.items) ||
    typeof queue.total !== 'number' ||
    typeof queue.counts?.received !== 'number'
  )
    throw notAnAnswer();
  return queue;
}

/** One move. The same command id answers every retry of the same move, so a dropped answer never moves twice. */
export async function moveReport(
  tenant: string,
  move: {
    commandId: string;
    reportId: string;
    expectedState: 'received' | 'in_review';
    toState: Move['to'];
    note: string;
  },
  fetcher: Fetcher = fetch,
): Promise<ProblemReportMoved> {
  const note = oneLine(move.note);
  const body = {
    action: 'transition',
    commandId: move.commandId,
    reportId: move.reportId,
    expectedState: move.expectedState,
    toState: move.toState,
    ...(note ? { note } : {}),
  };
  return withStepUp(async () =>
    readJson<ProblemReportMoved>(await fetcher(url(tenant), post(body))),
  );
}

/** The words of every problem report of the person under an erasure request. The count is the one in the answer. */
export async function removeWordsUnderRequest(
  tenant: string,
  commandId: string,
  erasureRequestId: string,
  fetcher: Fetcher = fetch,
): Promise<ProblemReportWordsRemoved> {
  const done = await withStepUp(async () =>
    readJson<ProblemReportWordsRemoved>(
      await fetcher(url(tenant), post({ action: 'remove_words', commandId, erasureRequestId })),
    ),
  );
  if (!(Number.isInteger(done?.removed) && done.removed >= 0))
    throw new ActionError(removeWords.failed, 502);
  return done;
}

export const wordsRemovedMessage = (count: number) =>
  `Words removed from ${count} problem report${count === 1 ? '' : 's'}.`;
export const removalWordsUnderRequest = {
  button: 'Remove Words Under This Request',
  title: 'Remove words under this request?',
  body: 'This removes the words of every problem report of this person filed up to this request. It cannot be undone. Notes stay.',
  confirm: 'Remove Words',
  keep: 'Keep Words',
} as const;
