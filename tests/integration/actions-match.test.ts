import { describe, expect, test } from 'vitest';
import { liveActions } from '../../apps/web/lib/actions/catalogue';
import { matchActions, type MatchContext } from '../../apps/web/lib/actions/match';

const all: MatchContext = {
  switches: { delegations: true },
  modules: { support_case: true, problem_reports: true },
  hasWorkspace: true,
};
const first = (text: string, ctx = all) => matchActions(text, ctx)[0]?.id ?? null;

describe('matchActions', () => {
  for (const entry of liveActions) {
    test(`${entry.id}: nine phrases put it first`, () => {
      const phrases = [...entry.intent.phrases.en, ...entry.intent.synonyms].slice(0, 9);
      expect(phrases).toHaveLength(9);
      for (const phrase of phrases) expect(first(phrase), phrase).toBe(entry.id);
    });
  }

  test('case and accents do not matter', () => {
    expect(first('FIND MY REQUEST')).toBe('find_request');
  });

  test('unknown text, empty and one character return none', () => {
    expect(matchActions('purple elephants dance', all)).toEqual([]);
    expect(matchActions('', all)).toEqual([]);
    expect(matchActions('   ', all)).toEqual([]);
    expect(matchActions('s', all)).toEqual([]);
  });

  test('a near miss never invents coverage', () => {
    expect(matchActions('buyer', all).length).toBeLessThanOrEqual(1);
    expect(first('I have a buyer complaint about a shipping invoice')).toBeNull();
    expect(first('quarterly tax filing in Singapore')).toBeNull();
  });

  test('a fuzzy-only word is not a match', () => {
    expect(matchActions('rquest', all)).toEqual([]);
  });

  test('gates hide entries', () => {
    const off: MatchContext = { switches: {}, modules: {}, hasWorkspace: true };
    expect(matchActions('plan a trip', off).map((r) => r.id)).not.toContain('start_organise');
    expect(matchActions('report a problem', off).map((r) => r.id)).not.toContain('report_problem');
    expect(first('plan a trip', { ...all, switches: { delegations: false } })).not.toBe(
      'start_organise',
    );
  });

  test('routes come from the fixed table', () => {
    const row = (text: string) => matchActions(text, all)[0];
    expect(row('meet buyers')?.href).toBe('/plan?job=buyers');
    expect(row('find a supplier')?.href).toBe('/plan?job=sourcing');
    expect(row('buy machinery')?.href).toBe('/plan?job=machinery_procurement');
    expect(row('report a problem')?.href).toBe('/account/problem-reports/new');
    expect(row('plan a trip')?.href).toBe('/account/delegations/organise');
  });

  test('typed text never appears in an href', () => {
    const marker = 'zzqx7';
    for (const text of [
      `find my request ${marker}`,
      `${marker} meet buyers`,
      `meet buyers /${marker}`,
    ])
      for (const row of matchActions(text, all)) expect(row.href ?? '').not.toContain(marker);
    for (const row of matchActions('meet buyers ../../admin?x=1', all))
      expect(row.href ?? '').not.toMatch(/admin|\.\./);
  });

  test('without a workspace, workspace-bound actions have no href and say what is needed', () => {
    const row = matchActions('find my request', { ...all, hasWorkspace: false })[0];
    expect(row?.href).toBeNull();
    expect(row?.state).toBe('needs_info');
  });

  test('rows are ranked and scores are numbers', () => {
    const rows = matchActions('help', all);
    for (let i = 1; i < rows.length; i += 1)
      expect(rows[i - 1]!.score).toBeGreaterThanOrEqual(rows[i]!.score);
  });

  test('is pure: same input, same output', () => {
    expect(matchActions('sell abroad', all)).toEqual(matchActions('sell abroad', all));
  });

  test('ask_team is planned and never matches, even with support_case on', () => {
    for (const text of ['talk to a person', 'need help from your team', 'speak to someone'])
      expect(matchActions(text, all).map((r) => r.id)).not.toContain('ask_team');
    for (const row of matchActions('help', all)) expect(row.href).not.toBeNull();
  });

  test('every returned row has an href when a workspace is present', () => {
    for (const text of ['help', 'my', 'plan', 'what', 'find', 'report', 'trip', 'draft'])
      for (const row of matchActions(text, all))
        expect(row.href, `${text} ${row.id}`).not.toBeNull();
  });

  test('sell and source need no workspace', () => {
    const none: MatchContext = { ...all, hasWorkspace: false };
    const sell = matchActions('meet buyers', none)[0];
    expect(sell).toMatchObject({ id: 'start_sell', href: '/plan?job=buyers', state: 'ready' });
    const source = matchActions('find a supplier', none)[0];
    expect(source).toMatchObject({
      id: 'start_source',
      href: '/plan?job=sourcing',
      state: 'ready',
    });
    expect(matchActions('buy machinery', none)[0]?.href).toBe('/plan?job=machinery_procurement');
  });
});
