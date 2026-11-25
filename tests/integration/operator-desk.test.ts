import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { workspaceSections } from '../../apps/web/lib/workspace-navigation';
import { canTriage, problemReportQueueFragment } from '../../apps/web/lib/problem-report-queue';
import { uxSwitchNames, uxSwitchOn } from '../../apps/web/lib/ux-switches';
import { switchRegistry } from '../../apps/web/lib/owner-switches';
import {
  deskMap,
  itemForPlace,
  mapFor,
  placeHref,
  settingsLevel,
  teamAccountPlaces,
  teamItemsFor,
  teamMap,
  teamPins,
  teamPlacesFor,
  type TeamPlaceId,
} from '../../apps/web/lib/ux/team-map';
import {
  deskChip,
  deskRows,
  deskSentence,
  deskTotals,
  type DeskErasureRow,
  type MissionPage,
  type TodayMission,
} from '../../apps/web/lib/ux/team-today';
import {
  joinParts,
  partFailureWords,
  readFailureCanRetry,
  readFailureWords,
} from '../../apps/web/app/operator/read-failure';

// Operator desk (unit 11 of the Signed-in Review Board, owner approved 20 Nov 2026): navigation only regroups the same
// places, so the role gates do not move, and Today's number is the number of rows.
const roles = ['owner', 'admin', 'operator', 'reviewer', 'viewer', null] as const;
const read = (path: string) =>
  readFileSync(new URL(`../../apps/web/${path}`, import.meta.url), 'utf8');

function reachable(role: string | null, desk: boolean): Set<TeamPlaceId> {
  const found = new Set<TeamPlaceId>();
  for (const item of teamItemsFor(role, desk))
    for (const place of teamPlacesFor(item, role)) found.add(place.id);
  for (const place of settingsLevel(role)) found.add(place.id);
  for (const place of teamAccountPlaces(role)) found.add(place.id);
  return found;
}

describe('the desk grouping keeps every place and every role gate', () => {
  for (const role of roles) {
    test(`${role ?? 'unknown role'}: the union of places equals the places before the change`, () => {
      expect([...reachable(role, true)].sort()).toEqual([...reachable(role, false)].sort());
    });
  }
  test('seventeen places (Today and the sixteen sections) in the sidebar groups, none dropped, none twice', () => {
    const ids = deskMap.flatMap((item) => item.places.map((place) => place.id));
    expect(ids).toHaveLength(17);
    expect(new Set(ids).size).toBe(17);
    expect([...ids].sort()).toEqual(
      teamMap.flatMap((item) => item.places.map((place) => place.id)).sort(),
    );
    expect(workspaceSections.length).toBeGreaterThanOrEqual(16);
  });
  test('the five groups and their places', () => {
    expect(deskMap.map((item) => [item.label, item.places.map((place) => place.label)])).toEqual([
      ['Today', ['Today']],
      ['Missions', ['Missions', 'Meetings', 'Operations', 'Reports', 'Network']],
      ['Companies', ['Companies', 'Sources and claims', 'Evidence review', 'Assistance']],
      ['Money', ['Money', 'Dashboard']],
      ['Settings and checks', ['Health', 'Readiness', 'Audit', 'People and access', 'Settings']],
    ]);
  });
  test('operator, reviewer, viewer and an unknown role never see Settings and checks', () => {
    for (const role of ['operator', 'reviewer', 'viewer', null] as const)
      expect(teamItemsFor(role, true).some((item) => item.key === 'admin')).toBe(false);
    for (const role of ['owner', 'admin'] as const)
      expect(teamItemsFor(role, true).map((item) => item.label)).toContain('Settings and checks');
  });
  test('at most five places per group, and addresses do not change', () => {
    for (const role of roles)
      for (const item of teamItemsFor(role, true))
        expect(teamPlacesFor(item, role).length).toBeLessThanOrEqual(5);
    for (const place of deskMap.flatMap((item) => item.places))
      for (const urls of [true, false])
        expect(placeHref(place.id, urls, 'w1')).toBe(placeHref(place.id, urls, 'w1'));
    expect(placeHref('workspace-meetings', true, '')).toBe('/operator/meetings');
  });
  test('the item that holds a place follows the desk groups; the legacy map is untouched', () => {
    expect(itemForPlace('workspace-meetings', 'operator', true)).toBe('missions');
    expect(itemForPlace('workspace-meetings', 'operator')).toBe('meetings');
    expect(itemForPlace('workspace-ai', 'owner', true)).toBe('companies');
    expect(itemForPlace('ops-center', 'owner', true)).toBe('admin');
    expect(mapFor(false)).toBe(teamMap);
    expect(mapFor(true)).toBe(deskMap);
    expect(teamMap.map((item) => item.label)).toContain('Admin');
  });
});

describe('pinned queues', () => {
  test('only the roles that triage, with the addresses Today already used', () => {
    for (const role of roles) expect(teamPins(role, true).length > 0).toBe(canTriage(role));
    expect(teamPins('owner', true)).toEqual([
      {
        id: 'problem-reports',
        label: 'Problem Reports',
        href: `/operator#${problemReportQueueFragment}`,
      },
      {
        id: 'erasure',
        label: 'Erasure Requests',
        href: '/operator?tab=settings-erasure#workspace-settings',
      },
    ]);
  });
  test('the addresses work from any team page and keep the chosen workspace', () => {
    const workspace = '123e4567-e89b-42d3-a456-426614174000';
    for (const urls of [false, true]) {
      const [reports, erasure] = teamPins('owner', true, urls, workspace);
      // Same address as the Settings link of the sidebar itself.
      expect(erasure!.href).toContain(`workspace=${workspace}`);
      // The Erasure requests sub-tab is chosen in the address (SubTabs reads ?tab=), before any # part.
      expect(erasure!.href).toMatch(/[?&]tab=settings-erasure(#|$)/);
      expect(erasure!.href.split('#')[0]).toBe(
        placeHref('workspace-settings', urls, workspace).split('#')[0] +
          (placeHref('workspace-settings', urls, workspace).split('#')[0]!.includes('?')
            ? '&'
            : '?') +
          'tab=settings-erasure',
      );
      expect(erasure!.href).toContain(`workspace=${workspace}`);
      // The workspace home, with the panel's own fragment: never a bare fragment.
      expect(reports!.href).toBe(`/operator?workspace=${workspace}#${problemReportQueueFragment}`);
      expect(reports!.href.startsWith('#')).toBe(false);
      expect(erasure!.href.startsWith('#')).toBe(false);
    }
    expect(read('components/ux/team-sidebar.tsx')).toContain(
      'teamPins(role, problemReports, urls, tenant)',
    );
  });
  test('a failed or repeated read leaves no stale number, and a failed part says so on its closed row', () => {
    const today = read('app/operator/today.tsx');
    expect(today).toMatch(/clearPinCounts\(\);\s*setFailure\(readFailureKind\(error\)\)/);
    expect(today).toMatch(/const retry = \(\) => \{\s*clearPinCounts\(\);/);
    expect(today).toContain("'Not available'");
    expect(today).toMatch(/title="This week" summary=\{failed \? 'Not available' : null\}/);
  });
  test('Problem Reports is pinned only where Report a Problem is offered', () => {
    expect(teamPins('admin', false).map((pin) => pin.id)).toEqual(['erasure']);
    expect(teamPins('operator', true)).toEqual([]);
    expect(teamPins(null, true)).toEqual([]);
  });
  test('the sidebar draws them as a second labelled list, with a count only from a successful read', () => {
    const sidebar = read('components/ux/team-sidebar.tsx');
    expect(sidebar).toContain('aria-label="Queues"');
    expect(sidebar).toContain('teamPins(role, problemReports, urls, tenant)');
    expect(sidebar).toMatch(/count === null\s*\? null/);
    const counts = read('lib/ux/team-pin-counts.ts');
    expect(counts).toContain('problemReports: null, erasure: null');
    expect(read('app/operator/today.tsx')).toContain('reportsTile?.count ?? null');
    expect(read('app/operator/today.tsx')).toContain('erasure?.count ?? null');
  });
});

describe('the switch', () => {
  test('is named, described for the owner, and off unless exactly "true"', () => {
    expect(uxSwitchNames).toContain('CORRIDRA_UX_OPERATOR_DESK');
    expect(switchRegistry.some((entry) => entry.name === 'CORRIDRA_UX_OPERATOR_DESK')).toBe(true);
    expect(uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK', {})).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK', { CORRIDRA_UX_OPERATOR_DESK: '1' })).toBe(false);
    expect(uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK', { CORRIDRA_UX_OPERATOR_DESK: 'true' })).toBe(
      true,
    );
  });
  test('only the team layout and pages read it, and the frame defaults to the old sidebar', () => {
    expect(read('app/operator/layout.tsx')).toContain("uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK')");
    expect(read('components/ux/team-frame.tsx')).toContain('desk = false');
    expect(read('components/ux/team-sidebar.tsx')).toContain('desk = false');
    expect(read('app/operator/today.tsx')).toContain('desk = false');
    expect(read('app/operator/operator-entry.tsx')).toContain(
      "shellsV2 && uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK')",
    );
  });
});

const mission = (id: string, dueAt: string, company = `Invented ${id}`): TodayMission => ({
  id,
  status: 'DRAFT',
  due_at: dueAt,
  brief: { company, objective: 'Source suppliers', market: 'China' },
});
const page = (missions: TodayMission[], total = missions.length): MissionPage => ({
  missions,
  total,
});
const observedAt = '2026-11-20T12:00:00Z';

describe('Today: one set, one number', () => {
  test('the sentence for each case', () => {
    const t = (count: number, late: number, exact = true) =>
      deskSentence({ count, late, fresh: 0, exact });
    expect(t(4, 1)).toBe('4 things need you now. 1 is late.');
    expect(t(1, 1)).toBe('1 thing needs you now. It is late.');
    expect(t(3, 0)).toBe('3 things need you now. Nothing is late.');
    expect(t(12, 2, false)).toBe('At least 12 things need you now. 2 are late.');
    expect(t(0, 0)).toBe('Nothing needs you now.');
  });
  test('the count equals the rows: new requests, late missions and overdue erasure requests, once each', () => {
    const fresh = page([
      mission('a', '2026-11-25T00:00:00Z'),
      mission('b', '2026-11-10T00:00:00Z'),
    ]);
    const overdue = page([
      mission('b', '2026-11-10T00:00:00Z'),
      mission('c', '2026-11-16T00:00:00Z'),
    ]);
    const erasure: DeskErasureRow[] = [
      { id: 'e1', reference: 'ER-1', daysOverdue: 2, dueAt: '2026-11-18T00:00:00Z' },
    ];
    const rows = deskRows(fresh, overdue, erasure, observedAt);
    const totals = deskTotals(fresh, overdue, { rows: erasure, atLeast: false }, []);
    // deskTotals takes the merged mission rows only for the incomplete case; the exact count must equal the table.
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.key)).size).toBe(4);
    const exact = deskTotals(
      fresh,
      overdue,
      { rows: erasure, atLeast: false },
      rows
        .filter((row) => row.mission)
        .map((row) => ({ mission: row.mission!, fresh: row.fresh, overdue: row.late })),
    );
    expect(exact.count).toBe(rows.length);
    expect(exact.late).toBe(rows.filter((row) => row.late).length);
    expect(exact.exact).toBe(true);
    expect(totals.count).toBeGreaterThan(0);
  });
  test('most days late first, then soonest due; New rows after the late ones', () => {
    const rows = deskRows(
      page([mission('n1', '2026-11-30T00:00:00Z'), mission('n2', '2026-11-25T00:00:00Z')]),
      page([mission('l1', '2026-11-19T00:00:00Z'), mission('l2', '2026-11-10T00:00:00Z')]),
      [{ id: 'e', reference: 'ER-9', daysOverdue: 5, dueAt: '2026-11-15T00:00:00Z' }],
      observedAt,
    );
    expect(rows.map((row) => row.key)).toEqual(['l2', 'erasure:e', 'l1', 'n2', 'n1']);
  });
  test('the chip says Late with its days, Due today, New, or plain Late when the clock disagrees', () => {
    const rows = deskRows(
      page([mission('x', '2026-11-30T00:00:00Z')]),
      page([
        mission('l', '2026-11-16T00:00:00Z'),
        mission('t', '2026-11-20T06:00:00Z'),
        mission('y', '2026-11-19T01:00:00Z'),
        mission('s', '2026-11-25T00:00:00Z'),
      ]),
      [{ id: 'e', reference: 'ER-1', daysOverdue: 1, dueAt: '2026-11-19T00:00:00Z' }],
      observedAt,
    );
    const chip = (key: string) =>
      deskChip(
        rows.find((row) => row.key === key)!,
        observedAt,
      );
    expect(chip('l')).toBe('Late, 4 days');
    expect(chip('t')).toBe('Late, due today');
    expect(chip('y')).toBe('Late, 1 day');
    expect(chip('erasure:e')).toBe('Late, 1 day');
    expect(chip('x')).toBe('New');
    expect(chip('s')).toBe('Late');
  });
  test('an unfinished read says At least and never a smaller number than the rows', () => {
    const fresh = page([mission('a', '2026-11-25T00:00:00Z')], 40);
    const totals = deskTotals(fresh, page([]), null, [
      { mission: fresh.missions[0]!, fresh: true, overdue: false },
    ]);
    expect(totals.exact).toBe(false);
    expect(totals.count).toBe(40);
    expect(deskSentence(totals)).toBe('At least 40 things need you now. Nothing is late.');
    const erasureFull = deskTotals(page([]), page([]), { rows: [], atLeast: true }, []);
    expect(erasureFull.exact).toBe(false);
  });
});

describe('a part that could not be read', () => {
  test('names the part; Try Again only where asking again can help', () => {
    expect(partFailureWords('Also waiting', 'unavailable')).toBe(
      'Also waiting could not be read just now. Your work is safe.',
    );
    expect(partFailureWords('This week', 'denied')).toBe(
      `This week could not be read. ${readFailureWords('denied')}`,
    );
    expect(partFailureWords('Today', 'later')).toBe(
      `Today could not be read. ${readFailureWords('later')}`,
    );
    // A plural part needs no verb that agrees with it ("Erasure requests is not available" was the fault).
    expect(partFailureWords('Erasure requests', 'unavailable')).toBe(
      'Erasure requests could not be read just now. Your work is safe.',
    );
    expect(joinParts(['Erasure requests', 'Problem reports'])).toBe(
      'Erasure requests and problem reports',
    );
    // One "and", before the last name: a part that is itself two things is passed as two names.
    expect(joinParts(['Erasure requests', 'Problem reports', 'Meetings', 'Follow-ups'])).toBe(
      'Erasure requests, problem reports, meetings and follow-ups',
    );
    expect(joinParts(['This week'])).toBe('This week');
    expect(readFailureCanRetry('unavailable')).toBe(true);
    expect(readFailureCanRetry('later')).toBe(true);
    expect(readFailureCanRetry('denied')).toBe(false);
  });
  test('the table keeps its real structure and the old filter address', () => {
    const parts = read('app/operator/today-desk-parts.tsx');
    expect(parts).toContain(
      '<caption className="sr-only">Things that need you now, latest first</caption>',
    );
    expect(parts).toContain('aria-label={`Open ${what}, ${group}`}');
    expect(parts).toContain('aria-expanded={open}');
    const today = read('app/operator/today.tsx');
    expect(today).toContain('needsFilterFromSearch(window.location.search)');
    expect(today).toContain("addEventListener('popstate', read)");
    expect(today).toContain('The full list is in Missions.');
  });
});

describe('a failed read is never a false all-clear', () => {
  const empty = { missions: [], total: 0 };
  test('an erasure read that failed makes the total inexact and the sentence says so', () => {
    const totals = deskTotals(empty, empty, null, [], true);
    expect(totals.exact).toBe(false);
    expect(deskSentence(totals)).not.toBe('Nothing needs you now.');
    expect(deskSentence(totals)).toBe('Erasure requests could not be checked just now.');
    const some = deskTotals(
      { missions: [mission('a', '2026-11-25T00:00:00Z')], total: 1 },
      empty,
      null,
      [{ mission: mission('a', '2026-11-25T00:00:00Z'), fresh: true, overdue: false }],
      true,
    );
    expect(deskSentence(some)).toBe('At least 1 thing needs you now. Nothing is late.');
  });
  test('a role that does not read the queue, or a read that worked, is still exact', () => {
    expect(deskSentence(deskTotals(empty, empty, null, [], false))).toBe('Nothing needs you now.');
    expect(deskSentence(deskTotals(empty, empty, { rows: [], atLeast: false }, [], false))).toBe(
      'Nothing needs you now.',
    );
  });
  test('Today tells a failed erasure read from one that was not asked', () => {
    const today = read('app/operator/today.tsx');
    expect(today).toContain('erasureRead: reads.erasure');
    expect(today).toMatch(/today\.erasureRead && today\.erasure === null/);
    expect(today).toContain(
      'deskTotals(today.fresh, today.overdue, today.erasure, rows, erasureUnread)',
    );
  });
  test('Also waiting: a failed counts read hides only the counts, not the queues that were read', () => {
    const today = read('app/operator/today.tsx');
    const start = today.indexOf('function DeskAlsoWaiting');
    const body = today.slice(start, today.indexOf('The first thing an operator sees'));
    // The failure message no longer replaces the list: it is followed by the tiles, drawn whenever any exist.
    expect(body).not.toMatch(/teamFailure \? \(\s*<PartFailure[^]*?\) : \(\s*<ul/);
    expect(body).toMatch(/\{hasTiles && \(\s*<ul/);
    expect(body).toContain("'Partly not available'");
    // A count is drawn for a role that can read it, or when it was read: never "Not available" for a role that never can.
    expect(body).toMatch(/\{team && \(mayCount \|\| quotes !== null\) && \(\s*<WaitingItem/);
    expect(body).toMatch(/\{team && \(mayCount \|\| services !== null\) && \(\s*<WaitingItem/);
    expect(body).toMatch(/\{reports && \(/);
    expect(body).toMatch(/\{erasure && \(/);
  });
});
