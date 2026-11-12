// The words and the phase of the command palette's search (docs/revamp/specs/navigation-v1/command-palette-search.md,
// sections 3 and 5). Pure: it turns what the search returned into the summary line, the notices, the centred
// block and the one sentence for the screen reader. A denied, partial, failed or signed-out search is never
// described as "No match": the reader is told what happened. Owner: S4.
import type { PaletteScopeId } from './palette';

export type SearchPhase = 'idle' | 'searching' | 'ok' | 'signedout' | 'denied' | 'failed';
export type SearchOutcome<T> =
  { kind: 'ok'; found: T } | { kind: 'signedout' } | { kind: 'denied' } | { kind: 'failed' };

/** How long the spoken message must stay the same before it is announced, so typing makes one announcement. */
export const settleDelay = 500;

/** Which outcome an HTTP status means. 200 is handled by the caller (it has to read the answer). */
export function outcomeForStatus(status: number): 'signedout' | 'denied' | 'failed' {
  if (status === 401) return 'signedout';
  if (status === 403) return 'denied';
  return 'failed';
}

/** The outcome for the current search only: an answer to an older search (another key) is dropped. */
export function currentOutcome<T>(
  answer: { key: string; outcome: SearchOutcome<T> } | null,
  key: string,
): SearchOutcome<T> | null {
  return answer && answer.key === key ? answer.outcome : null;
}

export function phaseOf<T>(searchable: boolean, outcome: SearchOutcome<T> | null): SearchPhase {
  if (!searchable) return 'idle';
  if (!outcome) return 'searching';
  return outcome.kind === 'ok' ? 'ok' : outcome.kind;
}

type Searched = 'missions' | 'companies';
export function searchedScopes(scope: PaletteScopeId): Searched[] {
  if (scope === 'all') return ['missions', 'companies'];
  if (scope === 'missions' || scope === 'companies') return [scope];
  return [];
}

const names = (list: string[], joiner: string) => list.join(joiner);
const singular = (name: string) => (name === 'companies' ? 'company' : 'mission');
const results = (count: number) => `${count} ${count === 1 ? 'result' : 'results'}`;

export type StatusNotice = {
  tone: 'neutral' | 'caution' | 'critical';
  /** A bold first phrase, such as "Partial results." */
  lead?: string;
  text: string;
  icon?: 'lock';
};
export type StatusBlock = {
  kind: 'nomatch' | 'signedout';
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
  scope: PaletteScopeId;
  /** The trimmed query. */
  text: string;
  phase: SearchPhase;
  /** From the answer: the scopes the role may not search and the scopes searched only in part. */
  denied: string[];
  partial: string[];
  /** The options listed in the groups, actions included. */
  count: number;
  offline: boolean;
};

/** The helper line for a short or empty query. */
export function helperLine(scope: PaletteScopeId): string {
  if (scope === 'missions') return 'Type at least 2 letters to search missions.';
  if (scope === 'companies') return 'Type at least 2 letters to search companies.';
  if (scope === 'actions') return '';
  return 'Type at least 2 letters to search missions and companies.';
}

/** The centred line for an empty Missions or Companies list when nothing has been opened yet. */
export function noRecentsLine(scope: PaletteScopeId): string {
  if (scope === 'missions') return 'No recent missions yet.';
  if (scope === 'companies') return 'No recent companies yet.';
  return '';
}

function searchingLine(scope: PaletteScopeId): string {
  if (scope === 'missions') return 'Searching missions.';
  if (scope === 'companies') return 'Searching companies.';
  return 'Searching missions and companies';
}

const deniedSentence = (list: string[]) => `Your role cannot search ${names(list, ' or ')}.`;
const deniedNotice = (list: string[]): StatusNotice => ({
  tone: 'neutral',
  icon: 'lock',
  text: `${deniedSentence(list)} Ask an owner or admin if you need access.`,
});
const partialNotice = (list: string[]): StatusNotice => ({
  tone: 'caution',
  lead: 'Partial results.',
  text: `Not every ${names(list.map(singular), ' or ')} was searched. More may exist. Narrow your search.`,
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
  if (phase === 'searching') return { ...base, summary: searchingLine(scope), spoken: 'Searching' };
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
  const searched = searchedScopes(scope);
  if (phase === 'denied')
    return { ...base, notices: [deniedNotice(searched)], spoken: deniedSentence(searched) };

  // phase 'ok'
  const denied = searched.filter((name) => input.denied.includes(name));
  const allowed = searched.filter((name) => !denied.includes(name));
  const partial = allowed.filter((name) => input.partial.includes(name));
  const notices: StatusNotice[] = [];
  if (denied.length > 0) notices.push(deniedNotice(denied));
  if (count > 0) {
    if (partial.length > 0) notices.push(partialNotice(partial));
    let spoken = results(count);
    if (denied.length > 0)
      spoken = `${deniedSentence(denied)} ${results(count)}${
        allowed.length > 0 ? ` from ${names(allowed, ' and ')}` : ''
      }.`;
    else if (partial.length > 0)
      spoken = `${results(count)}. Not every ${names(partial.map(singular), ' or ')} was searched. Narrow your search.`;
    return { ...base, summary: results(count), notices, spoken };
  }
  // Nothing listed. Only a complete search with no denial may say there is no match.
  if (allowed.length === 0) return { ...base, notices, spoken: deniedSentence(denied) };
  if (partial.length > 0)
    return {
      ...base,
      notices,
      block: {
        kind: 'nomatch',
        icon: 'search',
        heading: 'No match in the part searched',
        lines: ['More may exist. Narrow your search.'],
      },
      spoken: 'No match in the part searched. More may exist.',
    };
  const lines = ['Try a different spelling or fewer letters.'];
  if (scope === 'missions' || scope === 'companies')
    lines.push(
      `You are searching ${scope === 'missions' ? 'Missions' : 'Companies'} only. Choose All to search everywhere.`,
    );
  const where = denied.length > 0 ? ` in ${names(allowed, ' and ')}` : '';
  return {
    ...base,
    notices,
    block: {
      kind: 'nomatch',
      icon: 'search',
      heading: `No match for “${text}”${where}`,
      lines,
    },
    spoken: `No match for ${text}${where}${denied.length > 0 ? '. ' + deniedSentence(denied) : ''}`,
  };
}
