import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import {
  deskHeadline,
  deskSentence,
  shortReference,
  shownLine,
  waitingMissions,
  type DeskTotals,
  type TodayMission,
} from '../../apps/web/lib/ux/team-today';

// Team desk v4.1, unit D5 (docs/revamp/specs/team-desk-v4-1.md section 5): Today's headline says what to do and
// never gives "at least"; the short reference is shown only when a read carried it; "Waiting on others" is the open
// missions that need no decision now. Pure functions over the reads the page already makes.
const read = (path: string) =>
  readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), 'utf8');
const day = 86400000;
const now = '2026-11-24T06:00:00.000Z';
const at = (days: number) => new Date(Date.parse(now) + days * day).toISOString();
const mission = (id: string, status: string, due: number): TodayMission => ({
  id,
  status,
  due_at: at(due),
  brief: { company: `Sample company ${id}`, objective: 'Source suppliers', market: 'China' },
});
const totals = (count: number, late: number, exact = true): DeskTotals => ({
  count,
  late,
  fresh: count - late,
  exact,
});

describe('the switch', () => {
  test('is registered, described for the owner and off unless the setting is exactly "true"', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_TEAM_DESK_V41');
    const entry = switchRegistry.find((item) => item.name === 'CORRIDRA_UX_TEAM_DESK_V41');
    expect(entry).toMatchObject({ label: 'Team desk v4.1', group: 'Team access', kind: 'flag' });
    expect(uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(
      uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {
        CORRIDRA_UX_TEAM_DESK_V41: 'TRUE',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41', {
        CORRIDRA_UX_TEAM_DESK_V41: 'true',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  test('is read on the server only for the team shell and reaches Today through the flags, default off', () => {
    expect(read('app/operator/operator-entry.tsx')).toContain(
      "teamDeskV41={shellsV2 && uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')}",
    );
    expect(read('app/operator/operator-flags.tsx')).toContain('teamDeskV41 = false');
    const today = read('app/operator/today.tsx');
    expect(today).toContain('const { teamDeskV41: deskV41 } = useOperatorFlags();');
    // A queue this role reads and could not read is never an all-clear, and a capped read is never exact.
    expect(today).toContain('(today.problemReportsRead && today.problemReports === null)');
    expect(today).toContain('(today.work?.partial ?? false)');
    // Off, the two earlier bodies are untouched: the desk branch and the first Today still render as written.
    expect(today).toContain('if (desk) {');
    expect(today).toContain('aria-label="Counts"');
  });
});

describe('the headline', () => {
  test('says what to do first', () => {
    expect(deskHeadline(totals(0, 0), 0)).toBe('Nothing needs your decision now.');
    expect(deskHeadline(totals(1, 0), 0)).toBe('1 thing needs your decision. Review it today.');
    expect(deskHeadline(totals(1, 1), 0)).toBe(
      '1 thing needs your decision. It is late, so review it first.',
    );
    expect(deskHeadline(totals(4, 0), 0)).toBe('4 things need your decision. Start at the top.');
    expect(deskHeadline(totals(4, 1), 0)).toBe(
      '4 things need your decision. Start with the one that is late.',
    );
    expect(deskHeadline(totals(6, 2), 0)).toBe(
      '6 things need your decision. Start with the 2 that are late.',
    );
  });

  test('never claims an all-clear while another queue waits or could not be read', () => {
    expect(deskHeadline(totals(0, 0), 3)).toBe(
      'No new requests and nothing late. Work through the lists below.',
    );
    expect(deskHeadline(totals(0, 0), null)).toBe(
      'No new requests and nothing late. Some lists could not be checked.',
    );
    expect(deskHeadline(totals(0, 0, false), 0)).toContain('could not be checked');
  });

  test('never says "at least" and never gives a lower bound as a number', () => {
    // The desk sentence it replaces does say it; the new headline must not, in any state.
    expect(deskSentence(totals(60, 50, false))).toContain('At least');
    for (const exact of [true, false])
      for (const count of [0, 1, 2, 60])
        for (const late of [0, 1, 2, 50].filter((n) => n <= count))
          for (const others of [0, 5, null]) {
            const words = deskHeadline(totals(count, late, exact), others);
            expect(words.toLowerCase()).not.toContain('at least');
            expect(words).not.toMatch(/\d\+/);
            if (!exact) expect(words).not.toMatch(/\d/);
          }
    expect(deskHeadline(totals(60, 50, false), 0)).toBe(
      'Start with the late ones at the top. Not all of them loaded here. See Missions for the full list.',
    );
    expect(shownLine(50, { count: 60, exact: false })).toBe('Showing 50. More are in Missions.');
    expect(shownLine(5, { count: 9, exact: true })).toBe(
      'Showing 5 of 9. The full list is in Missions.',
    );
    expect(shownLine(9, { count: 9, exact: true })).toBeNull();
  });
});

describe('the short reference', () => {
  test('is the one a read carried, in the RQ shape, and is never made from anything else', () => {
    expect(shortReference('RQ-000001')).toBe('RQ-000001');
    expect(shortReference('RQ-1000000')).toBe('RQ-1000000');
    for (const value of [undefined, null, '', 'rq-000001', 'RQ-', 'RP-000001', 'RQ-12 ', 7, {}])
      expect(shortReference(value)).toBeNull();
    expect(shortReference('00000000-0000-4000-8000-000000000001')).toBeNull();
  });
});

describe('waiting on others', () => {
  test('is the open missions that are neither a new request nor late, soonest due first', () => {
    const fresh = { missions: [mission('a', 'DRAFT', 5)], total: 1 };
    const overdue = { missions: [mission('b', 'OUTREACH', -3)], total: 1 };
    const open = {
      missions: [
        mission('a', 'DRAFT', 5),
        mission('b', 'OUTREACH', -3),
        mission('e', 'FOLLOW_UP', 9),
        mission('c', 'OUTREACH', 2),
        // A new request and a late mission the two short reads did not reach are still left out.
        mission('f', 'DRAFT', 4),
        mission('g', 'OUTREACH', -1),
        mission('d', 'TARGETING', 2),
      ],
      total: 7,
    };
    expect(waitingMissions(open, fresh, overdue, now).map((item) => item.id)).toEqual([
      'c',
      'd',
      'e',
    ]);
    expect(waitingMissions({ missions: [], total: 0 }, fresh, overdue, now)).toEqual([]);
  });
});
