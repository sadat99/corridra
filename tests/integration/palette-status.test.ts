import { describe, expect, test } from 'vitest';
import {
  currentOutcome,
  describeStatus,
  helperLine,
  noRecentsLine,
  outcomeForStatus,
  phaseOf,
  type StatusInput,
} from '../../apps/web/lib/ux/palette-status';

// The words of the palette's states (docs/revamp/specs/navigation-v1/command-palette-search.md, section 5): each
// state has its own words, and none of denied, partial, failed or signed out reads "No match" or "Nothing found".
const input = (over: Partial<StatusInput>): StatusInput => ({
  scope: 'all',
  text: 'mad',
  phase: 'ok',
  denied: [],
  partial: [],
  count: 0,
  offline: false,
  ...over,
});
const everything = (view: ReturnType<typeof describeStatus>) =>
  [
    view.summary,
    view.spoken,
    view.block?.heading ?? '',
    ...(view.block?.lines ?? []),
    ...view.notices.map((n) => `${n.lead ?? ''} ${n.text}`),
  ].join(' | ');

describe('empty and short queries', () => {
  test('the helper line names the scope', () => {
    expect(helperLine('all')).toBe('Type at least 2 letters to search missions and companies.');
    expect(helperLine('missions')).toBe('Type at least 2 letters to search missions.');
    expect(helperLine('companies')).toBe('Type at least 2 letters to search companies.');
    expect(helperLine('actions')).toBe('');
    expect(noRecentsLine('missions')).toBe('No recent missions yet.');
    expect(noRecentsLine('companies')).toBe('No recent companies yet.');
  });
  test('idle announces nothing', () => {
    const view = describeStatus(input({ phase: 'idle', text: '' }));
    expect(view.summary).toBe(helperLine('all'));
    expect(view.spoken).toBe('');
  });
  test('searching says what is searched', () => {
    expect(describeStatus(input({ phase: 'searching' })).summary).toBe(
      'Searching missions and companies',
    );
    expect(describeStatus(input({ phase: 'searching', scope: 'missions' })).summary).toBe(
      'Searching missions.',
    );
    expect(describeStatus(input({ phase: 'searching', scope: 'companies' })).summary).toBe(
      'Searching companies.',
    );
    expect(describeStatus(input({ phase: 'searching' })).spoken).toBe('Searching');
  });
});

describe('results', () => {
  test('one result and many', () => {
    expect(describeStatus(input({ count: 1 })).summary).toBe('1 result');
    expect(describeStatus(input({ count: 5 })).summary).toBe('5 results');
    expect(describeStatus(input({ count: 5 })).spoken).toBe('5 results');
  });
  test('partial results are named, with no number', () => {
    const view = describeStatus(input({ count: 5, partial: ['missions'] }));
    expect(view.notices).toEqual([
      {
        tone: 'caution',
        lead: 'Partial results.',
        text: 'Not every mission was searched. More may exist. Narrow your search.',
      },
    ]);
    expect(view.spoken).toBe('5 results. Not every mission was searched. Narrow your search.');
    expect(describeStatus(input({ count: 2, partial: ['companies'] })).notices[0]!.text).toContain(
      'Not every company was searched.',
    );
    expect(
      describeStatus(input({ count: 2, partial: ['missions', 'companies'] })).notices[0]!.text,
    ).toContain('Not every mission or company was searched.');
  });
});

describe('D1 a scope the role may not search is named, never empty', () => {
  test('companies denied with three mission results', () => {
    const view = describeStatus(input({ count: 3, denied: ['companies'] }));
    expect(view.notices).toEqual([
      {
        tone: 'neutral',
        icon: 'lock',
        text: 'Your role cannot search companies. Ask an owner or admin if you need access.',
      },
    ]);
    expect(view.spoken).toBe('Your role cannot search companies. 3 results from missions.');
    expect(view.block).toBeNull();
  });
  test('both scopes denied is not "No match"', () => {
    const view = describeStatus(input({ denied: ['missions', 'companies'] }));
    expect(view.notices[0]!.text).toContain('Your role cannot search missions or companies.');
    expect(view.block).toBeNull();
    expect(everything(view)).not.toMatch(/no match|nothing found/i);
  });
  test('a whole-route 403 names the searched scopes', () => {
    const view = describeStatus(input({ phase: 'denied', scope: 'companies' }));
    expect(view.notices[0]!.text).toContain('Your role cannot search companies.');
    expect(everything(view)).not.toMatch(/no match|nothing found/i);
  });
  test('no match with one scope denied names only the scope that was searched', () => {
    const view = describeStatus(input({ denied: ['companies'] }));
    expect(view.block!.heading).toBe('No match for “mad” in missions');
    expect(view.notices).toHaveLength(1);
  });
});

describe('no match', () => {
  test('a complete search with nothing found says no match and how to widen it', () => {
    const view = describeStatus(input({}));
    expect(view.block).toEqual({
      kind: 'nomatch',
      icon: 'search',
      heading: 'No match for “mad”',
      lines: ['Try a different spelling or fewer letters.'],
    });
    expect(view.spoken).toBe('No match for mad');
    const missionsOnly = describeStatus(input({ scope: 'missions' }));
    expect(missionsOnly.block!.lines).toEqual([
      'Try a different spelling or fewer letters.',
      'You are searching Missions only. Choose All to search everywhere.',
    ]);
  });
  test('a partial search with nothing found does not claim there is no match', () => {
    const view = describeStatus(input({ partial: ['missions'] }));
    expect(view.block!.heading).toBe('No match in the part searched');
    expect(view.block!.lines).toEqual(['More may exist. Narrow your search.']);
    expect(view.notices).toEqual([]);
  });
});

describe('R1 failure and signed out', () => {
  test('failed reads as failed, offers Retry first and keeps the typed words', () => {
    const view = describeStatus(input({ phase: 'failed' }));
    expect(view.retry).toBe(true);
    expect(view.notices).toEqual([
      { tone: 'critical', text: 'The search did not finish. Try again.' },
    ]);
    expect(view.spoken).toBe('The search did not finish. Retry is the first option.');
    expect(everything(view)).not.toMatch(/no match|nothing found/i);
  });
  test('offline has its own words', () => {
    const view = describeStatus(input({ phase: 'failed', offline: true }));
    expect(view.notices[0]!.text).toBe('You are offline. Check your connection, then try again.');
  });
  test('D3 signed out has a heading, a body and a Sign In option', () => {
    const view = describeStatus(input({ phase: 'signedout' }));
    expect(view.block).toEqual({
      kind: 'signedout',
      icon: 'lock',
      heading: 'You are signed out',
      lines: ['Sign in again to keep searching.'],
    });
    expect(view.signIn).toBe(true);
    expect(view.spoken).toBe('You are signed out. Sign in again to keep searching.');
    expect(everything(view)).not.toMatch(/no match|nothing found/i);
  });
  test('status codes map to phases', () => {
    expect(outcomeForStatus(401)).toBe('signedout');
    expect(outcomeForStatus(403)).toBe('denied');
    expect(outcomeForStatus(400)).toBe('failed');
    expect(outcomeForStatus(500)).toBe('failed');
    expect(outcomeForStatus(503)).toBe('failed');
  });
  test('an answer for an older search is dropped, and a retry changes the key', () => {
    const answer = { key: 't|all|mad|0', outcome: { kind: 'failed' as const } };
    expect(currentOutcome(answer, 't|all|mad|0')).toEqual({ kind: 'failed' });
    expect(currentOutcome(answer, 't|all|madr|0')).toBeNull();
    expect(currentOutcome(answer, 't|all|mad|1')).toBeNull();
    expect(currentOutcome(null, 'x')).toBeNull();
  });
  test('the phase follows the outcome', () => {
    expect(phaseOf(false, null)).toBe('idle');
    expect(phaseOf(true, null)).toBe('searching');
    expect(phaseOf(true, { kind: 'ok', found: 1 })).toBe('ok');
    expect(phaseOf(true, { kind: 'signedout' })).toBe('signedout');
    expect(phaseOf(true, { kind: 'denied' })).toBe('denied');
    expect(phaseOf(true, { kind: 'failed' })).toBe('failed');
  });
});

describe('the words never use a dash as punctuation', () => {
  test('no state contains an em dash', () => {
    const states: StatusInput[] = [
      input({ phase: 'idle' }),
      input({ phase: 'searching' }),
      input({ count: 3, denied: ['companies'], partial: ['missions'] }),
      input({ phase: 'failed' }),
      input({ phase: 'signedout' }),
      input({}),
      input({ partial: ['missions'] }),
    ];
    for (const state of states) expect(everything(describeStatus(state))).not.toContain('—');
  });
});
