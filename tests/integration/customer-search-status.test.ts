import { describe, expect, test } from 'vitest';
import {
  companyDetailLine,
  currentOutcome,
  customerScopeList,
  describeStatus,
  helperLine,
  isShortcut,
  moveSelection,
  nextScope,
  outcomeForStatus,
  phaseOf,
  requestDetailLine,
  scopeSpoken,
  searchable,
  selectionIndex,
  type CustomerScopeId,
  type SearchPhase,
  type StatusInput,
} from '../../apps/web/lib/ux/customer-search-status';
import type { ScopeState } from '../../apps/web/lib/ux/customer-search-facts';
import {
  isPaletteShortcut,
  moveSelection as staffMove,
  selectionIndex as staffIndex,
} from '../../apps/web/lib/ux/palette';

// P4 and R5 (docs/revamp/specs/navigation-v1/customer-search.md, sections 8 and 9): each state has its own words, and
// none of partial, denied, unavailable, archived, closed, signed out or failed reads "No match".
const input = (over: Partial<StatusInput>): StatusInput => ({
  scope: 'all',
  text: 'spain',
  phase: 'ok',
  scopes: { requests: 'ok', companies: 'ok' },
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
const noMatch = /no match|nothing found/i;

describe('P4 the keyboard helpers behave as the staff palette does', () => {
  test('moveSelection and selectionIndex agree with the staff module on a table', () => {
    for (const count of [0, 1, 2, 7])
      for (let current = -2; current <= count + 1; current++) {
        for (const key of ['ArrowUp', 'ArrowDown'] as const)
          expect(moveSelection(current, key, count)).toBe(staffMove(current, key, count));
        expect(selectionIndex(current, count)).toBe(staffIndex(current, count));
      }
  });
  test('Up and Down stop at the ends', () => {
    expect(moveSelection(0, 'ArrowUp', 3)).toBe(0);
    expect(moveSelection(2, 'ArrowDown', 3)).toBe(2);
    expect(moveSelection(-1, 'ArrowDown', 3)).toBe(0);
    expect(moveSelection(0, 'ArrowDown', 0)).toBe(-1);
  });
  test('the shortcut is Ctrl K or Command K and nothing else, as for staff', () => {
    const base = { key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    for (const event of [
      base,
      { ...base, ctrlKey: true },
      { ...base, metaKey: true },
      { ...base, ctrlKey: true, key: 'K' },
      { ...base, ctrlKey: true, altKey: true },
      { ...base, ctrlKey: true, shiftKey: true },
      { ...base, ctrlKey: true, key: 'j' },
    ])
      expect(isShortcut(event)).toBe(isPaletteShortcut(event));
    expect(isShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isShortcut({ ...base, metaKey: true })).toBe(true);
  });
  test('Tab cycles All, Requests, Companies, Pages with wrap, and Shift+Tab goes back', () => {
    expect(customerScopeList.map((scope) => scope.label)).toEqual([
      'All',
      'Requests',
      'Companies',
      'Pages',
    ]);
    const order: CustomerScopeId[] = ['all', 'requests', 'companies', 'pages'];
    for (let n = 0; n < 4; n++) {
      expect(nextScope(order[n]!, false)).toBe(order[(n + 1) % 4]);
      expect(nextScope(order[n]!, true)).toBe(order[(n + 3) % 4]);
    }
  });
  test('the scope change is spoken', () => {
    expect(scopeSpoken('all')).toBe('Search in All');
    expect(scopeSpoken('requests')).toBe('Search in Requests');
    expect(scopeSpoken('pages')).toBe('Search in Pages');
  });
});

describe('P5 what is worth sending', () => {
  test('under two letters, or only symbols, or the Pages scope, nothing is sent', () => {
    for (const text of ['', ' ', 'a', ' a ', '!!', '--', '  ?  '])
      expect(searchable('all', text)).toBe(false);
    expect(searchable('all', 'sp')).toBe(true);
    expect(searchable('requests', ' spain ')).toBe(true);
    expect(searchable('pages', 'spain')).toBe(false);
  });
  test('the phase follows the words, the scope and the answer', () => {
    expect(phaseOf('all', 'a', null)).toBe('idle');
    expect(phaseOf('all', 'spain', null)).toBe('searching');
    expect(phaseOf('all', 'spain', { kind: 'ok', found: 1 })).toBe('ok');
    expect(phaseOf('requests', 'spain', { kind: 'signedout' })).toBe('signedout');
    expect(phaseOf('pages', '', null)).toBe('idle');
    expect(phaseOf('pages', 'bill', null)).toBe('ok');
    expect(phaseOf('pages', '!!', null)).toBe('idle');
  });
  test('an answer to an older search is dropped', () => {
    const answer = { key: 'all|spain|0', outcome: { kind: 'ok', found: 1 } as const };
    expect(currentOutcome(answer, 'all|spain|0')).toEqual({ kind: 'ok', found: 1 });
    expect(currentOutcome(answer, 'all|spaim|0')).toBeNull();
    expect(currentOutcome(answer, 'all|spain|1')).toBeNull();
    expect(currentOutcome(null, 'x')).toBeNull();
  });
  test('each status code means its own outcome', () => {
    expect(outcomeForStatus(401)).toBe('signedout');
    expect(outcomeForStatus(403)).toBe('denied');
    expect(outcomeForStatus(403, 'account_closed')).toBe('closed');
    expect(outcomeForStatus(409)).toBe('denied');
    expect(outcomeForStatus(503)).toBe('unavailable');
    for (const status of [400, 413, 415, 429, 500, 502])
      expect(outcomeForStatus(status)).toBe('failed');
  });
});

describe('words of the quiet states', () => {
  test('the helper line names the scope', () => {
    expect(helperLine('all')).toBe(
      'Type at least 2 letters to search your Requests and Companies.',
    );
    expect(helperLine('requests')).toBe('Type at least 2 letters to search your Requests.');
    expect(helperLine('companies')).toBe('Type at least 2 letters to search your Companies.');
    expect(helperLine('pages')).toBe('');
  });
  test('idle shows the helper line and announces nothing', () => {
    const view = describeStatus(input({ phase: 'idle', text: '' }));
    expect(view.summary).toBe(helperLine('all'));
    expect(view.spoken).toBe('');
  });
  test('searching says what is searched', () => {
    expect(describeStatus(input({ phase: 'searching' })).summary).toBe(
      'Searching Requests and Companies.',
    );
    expect(describeStatus(input({ phase: 'searching', scope: 'requests' })).summary).toBe(
      'Searching Requests.',
    );
    expect(describeStatus(input({ phase: 'searching', scope: 'companies' })).summary).toBe(
      'Searching Companies.',
    );
  });
  test('results count the shown rows', () => {
    expect(describeStatus(input({ count: 1 })).summary).toBe('1 result');
    expect(describeStatus(input({ count: 5 })).summary).toBe('5 results');
    expect(describeStatus(input({ count: 5 })).spoken).toBe('5 results.');
  });
});

describe('R5 no state that is not a complete search says "No match"', () => {
  const states: ScopeState[] = ['ok', 'partial', 'unavailable', 'denied', 'archived'];
  const phases: SearchPhase[] = [
    'idle',
    'searching',
    'ok',
    'signedout',
    'denied',
    'closed',
    'unavailable',
    'failed',
  ];
  const scopes: CustomerScopeId[] = ['all', 'requests', 'companies', 'pages'];
  test('every phase, scope, state pair and count, both online and offline', () => {
    let seen = 0;
    for (const phase of phases)
      for (const scope of scopes)
        for (const requests of states)
          for (const companies of states)
            for (const count of [0, 3])
              for (const offline of [false, true]) {
                seen += 1;
                const view = describeStatus(
                  input({ phase, scope, count, offline, scopes: { requests, companies } }),
                );
                const text = everything(view);
                const searched =
                  scope === 'all'
                    ? [requests, companies]
                    : scope === 'requests'
                      ? [requests]
                      : scope === 'companies'
                        ? [companies]
                        : [];
                const label = `${phase} ${scope} ${requests} ${companies} ${count}`;
                // "No match" may appear only for a finished search that listed nothing.
                if (phase !== 'ok' || count > 0) {
                  expect(text, label).not.toMatch(noMatch);
                  continue;
                }
                if (searched.includes('partial')) {
                  expect(text, label).toMatch(/Search was partial/);
                  expect(text, label).not.toMatch(noMatch);
                } else if (searched.length > 0 && !searched.includes('ok')) {
                  expect(text, label).not.toMatch(noMatch);
                } else if (searched.some((state) => state !== 'ok')) {
                  // One scope answered and another did not: the heading names only the one that answered.
                  expect(text, label).toMatch(/No match for “spain” in (Requests|Companies)/);
                } else expect(text, label).toMatch(/No match for “spain”/);
              }
    expect(seen).toBe(8 * 4 * 5 * 5 * 2 * 2);
  });
  test('a complete search with nothing found says no match, with the typed words', () => {
    const view = describeStatus(input({}));
    expect(view.block?.heading).toBe('No match for “spain”');
    expect(view.block?.lines).toEqual([
      'Try a different spelling or fewer letters.',
      'Only Requests you sent are searched.',
    ]);
    expect(view.notices).toEqual([]);
  });
  test('a single scope adds the line that says what is not searched', () => {
    const view = describeStatus(input({ scope: 'requests' }));
    expect(view.block?.lines).toEqual([
      'Try a different spelling or fewer letters.',
      'Only Requests you sent are searched.',
      'You are searching Requests only. Choose All to search Requests, Companies and pages.',
    ]);
    const companies = describeStatus(input({ scope: 'companies' }));
    expect(companies.block?.lines).toEqual([
      'Try a different spelling or fewer letters.',
      'You are searching Companies only. Choose All to search Requests, Companies and pages.',
    ]);
  });
  test('partial results are named, with no number and no "No match"', () => {
    const view = describeStatus(
      input({ count: 5, scopes: { requests: 'partial', companies: 'ok' } }),
    );
    expect(view.notices).toEqual([
      {
        tone: 'caution',
        lead: 'Partial results.',
        text: 'Not every Request was searched. More may exist. Narrow your search or try again.',
      },
    ]);
    expect(view.spoken).toBe(
      '5 results. Not every Request was searched. Narrow your search or try again.',
    );
    const both = describeStatus(
      input({ count: 2, scopes: { requests: 'partial', companies: 'partial' } }),
    );
    expect(both.notices[0]!.text).toContain('Not every Request or Company was searched');
  });
  test('nothing listed from a partial scope says the search was partial, never no match', () => {
    const view = describeStatus(input({ scopes: { requests: 'partial', companies: 'ok' } }));
    expect(view.block).toMatchObject({
      heading: 'Search was partial',
      lines: ['Nothing in the part that was searched matched. More may exist. Narrow your search.'],
    });
    expect(view.spoken).toBe('Search was partial. Nothing in the part that was searched matched.');
    expect(everything(view)).not.toMatch(noMatch);
  });
  test('one scope unavailable: the other still answers, and the notice stays', () => {
    const view = describeStatus(input({ scopes: { requests: 'ok', companies: 'unavailable' } }));
    expect(view.block?.heading).toBe('No match for “spain” in Requests');
    expect(view.notices).toEqual([
      { tone: 'neutral', text: 'Searching Companies is not available right now.' },
    ]);
    const both = describeStatus(
      input({ scopes: { requests: 'unavailable', companies: 'unavailable' } }),
    );
    expect(both.block).toBeNull();
    expect(both.notices[0]!.text).toBe(
      'Searching Requests and Companies is not available right now.',
    );
  });
  test('an archived workspace is a Requests notice, not an empty list', () => {
    const view = describeStatus(input({ scope: 'requests', scopes: { requests: 'archived' } }));
    expect(view.block).toBeNull();
    expect(view.notices[0]!.text).toBe(
      'Requests cannot be searched while one of your workspaces is archived.',
    );
  });
  test('a scope the answer does not name is unavailable, not empty', () => {
    const view = describeStatus(input({ scope: 'requests', scopes: {} }));
    expect(view.block).toBeNull();
    expect(everything(view)).not.toMatch(noMatch);
  });
  test('a denied scope offers Sign In and keeps its words', () => {
    const view = describeStatus(input({ scope: 'companies', scopes: { companies: 'denied' } }));
    expect(view.signIn).toBe(true);
    expect(view.notices[0]).toMatchObject({ tone: 'neutral', icon: 'lock' });
    expect(view.notices[0]!.text).toBe(
      'Your access could not be confirmed. Sign in again or ask the Corridra team about your access.',
    );
  });
  test('signed out has a Sign In option and its own block', () => {
    const view = describeStatus(input({ phase: 'signedout' }));
    expect(view.signIn).toBe(true);
    expect(view.block).toEqual({
      kind: 'signedout',
      icon: 'lock',
      heading: 'You are signed out',
      lines: ['Sign in again to keep searching.'],
    });
    expect(view.spoken).toBe('You are signed out. Sign in again to keep searching.');
  });
  test('a closed account has its own block and no Sign In', () => {
    const view = describeStatus(input({ phase: 'closed' }));
    expect(view.signIn).toBe(false);
    expect(view.block).toMatchObject({
      kind: 'closed',
      heading: 'Your account is closed',
      lines: ['Search is turned off while your account is closed.'],
    });
  });
  test('a failed search offers Retry first, and offline says so', () => {
    const failed = describeStatus(input({ phase: 'failed' }));
    expect(failed.retry).toBe(true);
    expect(failed.notices[0]!.text).toBe('The search did not finish. Try again.');
    expect(failed.spoken).toBe('The search did not finish. Retry is the first option.');
    const offline = describeStatus(input({ phase: 'failed', offline: true }));
    expect(offline.notices[0]!.text).toBe(
      'You are offline. Check your connection, then try again.',
    );
    expect(offline.spoken).toContain('Retry is the first option.');
  });
  test('the whole route unavailable still lets the person open pages', () => {
    expect(describeStatus(input({ phase: 'unavailable' })).notices[0]!.text).toBe(
      'Search is not available right now. You can still open pages.',
    );
  });
  test('the Pages scope with nothing found says no match and does not mention Requests', () => {
    const view = describeStatus(input({ scope: 'pages', scopes: {} }));
    expect(view.block?.heading).toBe('No match for “spain”');
    expect(view.block?.lines).toEqual(['Try a different spelling or fewer letters.']);
  });
});

describe('detail lines', () => {
  test('a Request line carries the sent date and the status words of the Requests page', () => {
    expect(requestDetailLine('12 Nov 2026', { sent: 'x', status: 'ACTIVE' })).toBe(
      'Sent 12 Nov 2026 · Status: Find',
    );
    expect(requestDetailLine('12 Nov 2026', { sent: 'x', status: 'QUALIFICATION' })).toBe(
      'Sent 12 Nov 2026 · Status: Received, waiting for review',
    );
    expect(requestDetailLine('12 Nov 2026', { sent: 'x', status: 'ON_HOLD' })).toBe(
      'Sent 12 Nov 2026 · Status: Paused',
    );
    expect(requestDetailLine('12 Nov 2026', { sent: 'x' })).toBe('Sent 12 Nov 2026');
    expect(requestDetailLine('12 Nov 2026', undefined)).toBe('Sent 12 Nov 2026');
  });
  test('a withdrawn Request says so and shows no status', () => {
    expect(requestDetailLine('3 Nov 2026', { sent: 'x', status: 'DEFINE', withdrawn: true })).toBe(
      'Sent 3 Nov 2026 · You withdrew this request',
    );
  });
  test('a Company line says "found", never a total', () => {
    expect(companyDetailLine('Spain', 2)).toBe('Spain · 2 approved reports found');
    expect(companyDetailLine('Spain', 1)).toBe('Spain · 1 approved report found');
    expect(companyDetailLine('', 3)).toBe('3 approved reports found');
    expect(companyDetailLine('Spain', undefined)).toBe('Spain');
  });
});
