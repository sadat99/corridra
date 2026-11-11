import type { ProblemReportCategory, ProblemReportStatus } from '@corridra/domain/problem-report';

// Every sentence of the Report a Problem screens (docs/revamp/specs/problem-reports.md sections 4 to 6). The customer and
// the team member read the same words except where the spec names the other reader ("The Corridra team" or "An owner or
// admin"). Plain English: another language needs a reviewed catalog entry first (ADR-066).
export type ReportSide = 'customer' | 'team';

export const categoryWords: Record<
  ProblemReportCategory,
  { label: string; hint: string; icon: string }
> = {
  did_not_work: {
    label: 'Something did not work',
    hint: 'A button, page or save did not work.',
    icon: 'help',
  },
  could_not_find: {
    label: 'I could not find something',
    hint: 'You looked for a page or an action and it was not there.',
    icon: 'search',
  },
  words_wrong: {
    label: 'Words or information are wrong',
    hint: 'A word, number, date or name looks wrong.',
    icon: 'document',
  },
  something_else: {
    label: 'Something else',
    hint: 'Tell us in your own words below.',
    icon: 'more',
  },
};

export const statusLabels: Record<ProblemReportStatus, string> = {
  received: 'Received',
  in_review: 'In review',
  resolved: 'Resolved',
  closed: 'Closed',
};

const readers = { customer: 'the Corridra team', team: 'an owner or admin' } as const;
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const statusMeaning = (status: ProblemReportStatus, side: ReportSide) =>
  ({
    received: 'We have your problem report. Nobody has started on it yet.',
    in_review:
      side === 'customer'
        ? 'Someone in the Corridra team is looking at it.'
        : 'An owner or admin is looking at it.',
    resolved: 'The Corridra team dealt with it. The note says what was done.',
    closed: 'The Corridra team closed it. The note says why.',
  })[status];

export const noteFrom = (side: ReportSide) => `Note from ${readers[side]}`;
export const reviewSentence = (side: ReportSide) => `${upperFirst(readers[side])} will review it.`;

export const formWords = {
  stepOneTitle: 'What went wrong?',
  stepOneMeta: 'Step 1 of 2 · About 1 minute',
  steps: ['What went wrong', 'Check and send'],
  stepsLabel: 'Steps',
  whereLegend: 'Where did it happen?',
  thisPage: 'This page',
  anotherPage: 'Another page',
  pageField: 'Which page or screen?',
  pageHint: 'For example: Requests, or the Meetings page.',
  detailLabel: 'Tell us more',
  optional: 'Optional',
  required: 'Required',
  detailHint:
    "What did you try, and what happened? Do not include passwords, card numbers or other people's personal details.",
  counter: (length: number, max: number) => `${length} of ${max} characters`,
  continue: 'Continue',
  notNow: 'Not Now',
  stepTwoTitle: 'Check your problem report',
  stepTwoIntro: 'Check these details. When they look right, send your problem report.',
  summaryWhat: 'What went wrong',
  summaryWhere: 'Where',
  summaryDetail: 'What you told us',
  nothingAdded: 'Nothing added.',
  edit: 'Edit',
  editWhat: 'Edit What Went Wrong',
  editWhere: 'Edit Where',
  editDetail: 'Edit Tell Us More',
  send: 'Send Problem Report',
  back: 'Back',
  sending: 'Sending…',
  errorCategory: 'Choose what went wrong.',
  errorPage: 'Write which page or screen.',
  errorDetail: 'Write at least 10 characters about what happened.',
  errorPlain: 'Take out web addresses, email addresses and unusual characters, then try again.',
  sentTitle: 'We received your problem report',
  sentReference: (reference: string) => `Your reference is ${reference}.`,
  sentNoEmail: 'We do not send email about this. Check its status here.',
  seeList: 'See Your Problem Reports',
  goBack: 'Go Back to Where You Were',
} as const;

export const listWords = {
  loading: 'Loading…',
  empty: 'You have not reported a problem.',
  report: 'Report a Problem',
  loadError: 'Your problem reports could not be loaded. Check your connection and try again.',
  tryAgain: 'Try Again',
  showOlder: 'Show Older Problem Reports',
  meaningTitle: 'What Each Status Means',
  columns: { reference: 'Reference', status: 'Status', category: 'Category', filed: 'Filed' },
  listLabel: 'Your problem reports',
  wordsGone: 'The words of this problem report were removed.',
} as const;

export const detailWords = {
  notFound: 'We could not find this problem report.',
  told: 'What you told us',
  where: 'Where',
  category: 'What went wrong',
  details: 'Details',
  history: 'History',
  anotherPage: 'Another page',
  thisPage: 'This page',
} as const;

export const removalWords = {
  summary: 'Remove the words of my reports',
  button: 'Remove the Words of My Reports',
  title: 'Remove the words of your reports?',
  body: 'This removes what you wrote in all your problem reports. We keep the reference, the category, the dates, our replies and the status. This cannot be undone. Reports you file later keep their words until you remove them again.',
  confirm: 'Remove Words',
  keep: 'Keep Words',
  done: (count: number) =>
    count === 0
      ? 'You have no words left to remove.'
      : `Words removed from ${count} ${count === 1 ? 'report' : 'reports'}.`,
} as const;

export const failureWords = {
  unavailable: 'Problem reports are not available yet.',
  unavailableFile: 'You cannot report a problem here yet. Nothing was sent.',
  signedOut: 'Your sign-in has ended. Sign in again, then come back to this form.',
  signedOutAgain: 'Your sign-in has ended. Sign in again, then try again.',
  signIn: 'Sign In Again',
  fileNetwork:
    'Your problem report was not sent. Check your connection, then press Send Problem Report again. What you wrote is still here.',
  fileServer:
    'Your problem report was not sent. Try again in a few minutes. What you wrote is still here.',
  forbidden: 'You cannot report a problem from this account. Nothing was sent.',
  closed:
    'Your account is closed, so you cannot file a problem report. Nothing was sent. You can still read your problem reports and remove their words.',
  returnCustomer: 'Return to Your Account',
  returnTeam: 'Return to Today',
  readForbidden: 'You cannot read problem reports from this account.',
  removalFailed:
    'Your words were not removed. Check your connection or try again in a few minutes.',
  removalForbidden: 'You cannot remove words from this account. Nothing was changed.',
} as const;
