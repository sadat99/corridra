// The words, phases and keyboard rules of the customer search (docs/revamp/specs/navigation-v1/customer-search.md,
// sections 8 and 9). Pure. It turns what the search returned into the summary line, the notices, the centred block and
// the one sentence for the screen reader. A scope that is partial, denied, unavailable, archived, closed, signed out or
// failed is never described as "No match": the reader is told what happened. The keyboard helpers mirror the staff
// palette's; they are written here because the staff module pulls in the staff map, which a customer page must not load.
import { queryWords } from '../palette-rank';
import { customerStatusLabel } from './customer-road';
import type { CustomerFacts, CustomerScopeName, ScopeState } from './customer-search-facts';

export const customerScopeList = [
  { id: 'all', label: 'All' },
  { id: 'requests', label: 'Requests' },
  { id: 'companies', label: 'Companies' },
  { id: 'pages', label: 'Pages' },
] as const;
export type CustomerScopeId = (typeof customerScopeList)[number]['id'];

/** Every fixed word the dialog and its trigger show, in one place so one test can read them all. */
export const customerSearchWords = {
  trigger: 'Search',
  dialogName: 'Search Requests, Companies and pages',
  placeholder: 'Search Requests and Companies',
  close: 'Close',
  scopeGroup: 'Search in',
  groupRequests: 'Requests',
  groupCompanies: 'Companies',
  groupPages: 'Pages',
  emptyHeading: 'Pages you can open',
  statusGroup: 'Search status',
  kindRequest: 'Request',
  kindCompany: 'Company',
  kindPage: 'Page',
  closeMatch: 'Close match',
  withdrawn: 'Withdrawn',
  sample: 'Sample',
  footerKeys: 'Up Down Move · Enter Open · Tab Change scope',
  footerHonesty: 'Only your own Requests and Companies',
  retry: 'Retry',
  retryDetail: 'Search again with the same words',
  signIn: 'Sign In',
} as const;

export type SearchPhase =
  | 'idle'
  | 'searching'
  | 'ok'
  | 'signedout'
  | 'denied'
  | 'closed'
  | 'unavailable'
  | 'limited'
  | 'failed';
export type SearchOutcome<T> =
  | { kind: 'ok'; found: T }
  | { kind: 'signedout' }
  | { kind: 'denied' }
  | { kind: 'closed' }
  | { kind: 'unavailable' }
  | { kind: 'limited' }
  | { kind: 'failed' };

/** How long a search waits after the last key before it is sent. */
export const searchDelay = 350;
/** How long the spoken message must stay the same before it is announced, so typing makes one announcement. */
export const settleDelay = 500;
/** The code the route keeps on the answer for a closed account. */
export const accountClosedCode = 'account_closed';

/** Which outcome an HTTP status means. 200 is handled by the caller (it has to read the answer). */
export function outcomeForStatus(
  status: number,
  code?: unknown,
): 'signedout' | 'denied' | 'closed' | 'unavailable' | 'limited' | 'failed' {
  if (status === 401) return 'signedout';
  if (status === 403) return code === accountClosedCode ? 'closed' : 'denied';
  if (status === 409) return 'denied';
  if (status === 503) return 'unavailable';
  if (status === 429) return 'limited';
  return 'failed';
}

/** The outcome for the current search only: an answer to an older search (another key) is dropped. */
export function currentOutcome<T>(
  answer: { key: string; outcome: SearchOutcome<T> } | null,
  key: string,
): SearchOutcome<T> | null {
  return answer && answer.key === key ? answer.outcome : null;
}

/** True when the words are worth sending: two letters or more, and at least one letter or digit among them. */
export function searchable(scope: CustomerScopeId, text: string): boolean {
  return scope !== 'pages' && text.trim().length >= 2 && queryWords(text).length > 0;
}

/**
 * The phase. The Pages scope never waits for the server: it is `ok` as soon as anything is typed, and `idle` before.
 * For every other scope a query that is too short stays `idle`, so the helper line shows and nothing is sent.
 */
export function phaseOf<T>(
  scope: CustomerScopeId,
  text: string,
  outcome: SearchOutcome<T> | null,
): SearchPhase {
  if (scope === 'pages') return queryWords(text).length > 0 ? 'ok' : 'idle';
  if (!searchable(scope, text)) return 'idle';
  if (!outcome) return 'searching';
  return outcome.kind === 'ok' ? 'ok' : outcome.kind;
}

export function searchedScopes(scope: CustomerScopeId): CustomerScopeName[] {
  if (scope === 'all') return ['requests', 'companies'];
  if (scope === 'requests' || scope === 'companies') return [scope];
  return [];
}

const singular = (name: CustomerScopeName) => (name === 'companies' ? 'Company' : 'Request');
const plural = (name: CustomerScopeName) => (name === 'companies' ? 'Companies' : 'Requests');
const join = (list: string[]) => list.join(' and ');
const results = (count: number) => `${count} ${count === 1 ? 'result' : 'results'}`;

export type StatusNotice = {
  tone: 'neutral' | 'caution' | 'critical';
  /** A bold first phrase, such as "Partial results." */
  lead?: string;
  text: string;
  icon?: 'lock';
};
export type StatusBlock = {
  kind: 'nomatch' | 'signedout' | 'closed';
  icon: 'search' | 'lock';
  heading: string;
  lines: string[];
};
export type StatusView = {
  /** The line between the scope row and the list. */
  summary: string;
  notices: StatusNotice[];
  block: StatusBlock | null;
  /** The one sentence for the screen reader; empty when nothing should be announced. */
  spoken: string;
  /** The list starts with a Retry option. */
  retry: boolean;
  /** The list holds a Sign In option. */
  signIn: boolean;
};
export type StatusInput = {
  scope: CustomerScopeId;
  /** The trimmed query. */
  text: string;
  phase: SearchPhase;
  /** From the answer: the state of each scope searched. */
  scopes: Partial<Record<CustomerScopeName, ScopeState>>;
  /** The rows listed, local Pages rows included. */
  count: number;
  offline: boolean;
};

/** The helper line for a short or empty query. */
export function helperLine(scope: CustomerScopeId): string {
  if (scope === 'requests') return 'Type at least 2 letters to search your Requests.';
  if (scope === 'companies') return 'Type at least 2 letters to search your Companies.';
  if (scope === 'pages') return '';
  return 'Type at least 2 letters to search your Requests and Companies.';
}

function searchingLine(scope: CustomerScopeId): string {
  if (scope === 'requests') return 'Searching Requests.';
  if (scope === 'companies') return 'Searching Companies.';
  return 'Searching Requests and Companies.';
}

/** The sentence the screen reader hears when the scope changes. */
export function scopeSpoken(scope: CustomerScopeId): string {
  return `Search in ${customerScopeList.find((item) => item.id === scope)!.label}`;
}

const deniedText =
  'Your access could not be confirmed. Sign in again or ask the Corridra team about your access.';
const deniedNotice: StatusNotice = { tone: 'neutral', icon: 'lock', text: deniedText };
const unavailableSentence = (list: CustomerScopeName[]) =>
  `Searching ${join(list.map(plural))} is not available right now.`;
// The budget behind the Companies page ran out: it counts per hour, so the words say "later", not "a few seconds".
const limitedSentence = (list: CustomerScopeName[]) =>
  `Searching ${join(list.map(plural))} is paused because of too many requests. Try again later.`;
const archivedText = 'Requests cannot be searched while one of your workspaces is archived.';
const partialNotice = (list: CustomerScopeName[]): StatusNotice => ({
  tone: 'caution',
  lead: 'Partial results.',
  text: `Not every ${list.map(singular).join(' or ')} was searched. More may exist. Narrow your search or try again.`,
});

export function describeStatus(input: StatusInput): StatusView {
  const base: StatusView = {
    summary: '',
    notices: [],
    block: null,
    spoken: '',
    retry: false,
    signIn: false,
  };
  const { scope, text, phase, count } = input;
  if (phase === 'idle') return { ...base, summary: helperLine(scope) };
  if (phase === 'searching')
    return { ...base, summary: searchingLine(scope), spoken: 'Searching.' };
  if (phase === 'signedout')
    return {
      ...base,
      signIn: true,
      block: {
        kind: 'signedout',
        icon: 'lock',
        heading: 'You are signed out',
        lines: ['Sign in again to keep searching.'],
      },
      spoken: 'You are signed out. Sign in again to keep searching.',
    };
  if (phase === 'closed')
    return {
      ...base,
      block: {
        kind: 'closed',
        icon: 'lock',
        heading: 'Your account is closed',
        lines: ['Search is turned off while your account is closed.'],
      },
      spoken: 'Your account is closed. Search is turned off.',
    };
  if (phase === 'denied')
    return { ...base, signIn: true, notices: [deniedNotice], spoken: deniedText };
  if (phase === 'unavailable') {
    const line = 'Search is not available right now. You can still open pages.';
    return { ...base, notices: [{ tone: 'neutral', text: line }], spoken: line };
  }
  if (phase === 'limited') {
    // Too many searches in a short time: calm, never "No match", and the typed words are kept for Retry.
    const line = 'Too many searches just now. Wait a little, then try again.';
    return {
      ...base,
      retry: true,
      notices: [{ tone: 'neutral', text: line }],
      spoken: 'Too many searches just now. Wait a little. Retry is the first option.',
    };
  }
  if (phase === 'failed') {
    const line = input.offline
      ? 'You are offline. Check your connection, then try again.'
      : 'The search did not finish. Try again.';
    return {
      ...base,
      retry: true,
      notices: [{ tone: 'critical', text: line }],
      spoken: `${input.offline ? line : 'The search did not finish.'} Retry is the first option.`,
    };
  }

  // phase 'ok': the state of each scope searched. A scope the answer does not name is treated as unavailable.
  const searched = searchedScopes(scope);
  const stateOf = (name: CustomerScopeName): ScopeState => input.scopes[name] ?? 'unavailable';
  const only = (state: ScopeState) => searched.filter((name) => stateOf(name) === state);
  const partial = only('partial');
  const unavailable = only('unavailable');
  const archived = only('archived');
  const limited = only('limited');
  const denied = only('denied');
  const complete = only('ok');
  const notices: StatusNotice[] = [];
  const sentences: string[] = [];
  if (denied.length > 0) {
    notices.push(deniedNotice);
    sentences.push(deniedText);
  }
  if (archived.length > 0) {
    notices.push({ tone: 'neutral', text: archivedText });
    sentences.push(archivedText);
  }
  if (unavailable.length > 0) {
    notices.push({ tone: 'neutral', text: unavailableSentence(unavailable) });
    sentences.push(unavailableSentence(unavailable));
  }
  if (limited.length > 0) {
    notices.push({ tone: 'neutral', text: limitedSentence(limited) });
    sentences.push(limitedSentence(limited));
  }
  if (partial.length > 0) notices.push(partialNotice(partial));
  const signIn = denied.length > 0;
  if (count > 0) {
    const spoken = [
      `${results(count)}.`,
      ...(partial.length > 0
        ? [
            `Not every ${partial.map(singular).join(' or ')} was searched. Narrow your search or try again.`,
          ]
        : []),
      ...sentences,
    ].join(' ');
    return { ...base, summary: results(count), notices, spoken, signIn };
  }
  // Nothing listed. Only a complete search may say there is no match.
  if (partial.length > 0)
    return {
      ...base,
      notices,
      signIn,
      block: {
        kind: 'nomatch',
        icon: 'search',
        heading: 'Search was partial',
        lines: [
          'Nothing in the part that was searched matched. More may exist. Narrow your search.',
        ],
      },
      spoken: [
        'Search was partial. Nothing in the part that was searched matched.',
        ...sentences,
      ].join(' '),
    };
  if (searched.length > 0 && complete.length === 0)
    return { ...base, notices, signIn, spoken: sentences.join(' ') };
  const lines = ['Try a different spelling or fewer letters.'];
  if (scope === 'all' || scope === 'requests') lines.push('Only Requests you sent are searched.');
  if (scope === 'requests' || scope === 'companies')
    lines.push(
      `You are searching ${plural(scope)} only. Choose All to search Requests, Companies and pages.`,
    );
  const where = notices.length > 0 ? ` in ${join(complete.map(plural))}` : '';
  return {
    ...base,
    notices,
    signIn,
    block: {
      kind: 'nomatch',
      icon: 'search',
      heading: `No match for “${text}”${where}`,
      lines,
    },
    spoken: ['No match for ' + text + where + '.', ...sentences].join(' '),
  };
}

/** "Sent 12 Nov 2026 · Status: Find", or the withdrawn line. `sent` is the date as the person reads it. */
export function requestDetailLine(sent: string, facts: CustomerFacts | undefined): string {
  if (facts?.withdrawn) return `Sent ${sent} · You withdrew this request`;
  if (facts?.status)
    return `Sent ${sent} · Status: ${customerStatusLabel(facts.status, true).label}`;
  return `Sent ${sent}`;
}

/** "Spain · 2 approved reports found". The count is from the pages loaded in this search only, hence "found". */
export function companyDetailLine(country: string, reports: number | undefined): string {
  if (reports === undefined) return country;
  const found = `${reports} approved ${reports === 1 ? 'report' : 'reports'} found`;
  return country ? `${country} · ${found}` : found;
}

/** Up and Down move through the list and stop at the ends (no wrap); an empty list has no selection. */
export function moveSelection(
  current: number,
  key: 'ArrowUp' | 'ArrowDown',
  count: number,
): number {
  if (count === 0) return -1;
  if (key === 'ArrowDown') return Math.min(current + 1, count - 1);
  return Math.max(current - 1, 0);
}

/** The row that is selected: the stored index clamped to the rows that exist, and -1 only when there are none. */
export function selectionIndex(selected: number, count: number): number {
  return count === 0 ? -1 : Math.min(Math.max(selected, 0), count - 1);
}

/** Tab moves to the next scope and Shift+Tab to the previous, wrapping. */
export function nextScope(current: CustomerScopeId, backwards: boolean): CustomerScopeId {
  const ids = customerScopeList.map((scope) => scope.id);
  const at = ids.indexOf(current);
  return ids[(at + (backwards ? ids.length - 1 : 1)) % ids.length]!;
}

/** Ctrl K on most systems, Command K on a Mac. */
export function isShortcut(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    event.key.toLowerCase() === 'k' &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}
