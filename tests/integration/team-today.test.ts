import { describe, expect, test } from 'vitest';
import {
  daysLate,
  filterRows,
  filterTotal,
  lateLabel,
  needsCount,
  needsSummary,
  needsYouNow,
  type MissionPage,
  type TodayMission,
} from '../../apps/web/lib/ux/team-today';

// Team Today redesign (owner, 6 Nov 2026): "Needs you now" merges the new-request and past-due reads, and the
// one-line summary says only what the loaded totals prove.
const observedAt = '2026-11-06T12:00:00Z';
const mission = (id: string, status: string, dueAt: string): TodayMission => ({
  id,
  status,
  due_at: dueAt,
  brief: { company: `Invented ${id}`, objective: 'Source suppliers', market: 'China' },
});
const page = (missions: TodayMission[], total = missions.length): MissionPage => ({
  missions,
  total,
});

describe('needsYouNow', () => {
  test('lists a mission that is both new and late once, with both marks', () => {
    const both = mission('a', 'DRAFT', '2026-10-01T00:00:00Z');
    const rows = needsYouNow(page([both]), page([both]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fresh: true, overdue: true });
  });

  test('puts late missions first, the most overdue at the top, then the rest with the newest due date first', () => {
    const rows = needsYouNow(
      page([
        mission('new-early', 'DRAFT', '2026-11-20T00:00:00Z'),
        mission('new-late-due', 'DRAFT', '2026-12-20T00:00:00Z'),
      ]),
      page([
        mission('late-5', 'OUTREACH', '2026-11-01T00:00:00Z'),
        mission('late-36', 'FOLLOW_UP', '2026-10-01T00:00:00Z'),
      ]),
    );
    expect(rows.map((row) => row.mission.id)).toEqual([
      'late-36',
      'late-5',
      'new-late-due',
      'new-early',
    ]);
  });

  test('keeps a stable order by id when due dates are equal', () => {
    const due = '2026-10-01T00:00:00Z';
    const rows = needsYouNow(
      page([]),
      page([mission('b', 'OUTREACH', due), mission('a', 'OUTREACH', due)]),
    );
    expect(rows.map((row) => row.mission.id)).toEqual(['a', 'b']);
  });

  test('filters to new requests or to late missions', () => {
    const rows = needsYouNow(
      page([mission('new', 'DRAFT', '2026-12-01T00:00:00Z')]),
      page([mission('late', 'OUTREACH', '2026-10-01T00:00:00Z')]),
    );
    expect(filterRows(rows, 'all')).toHaveLength(2);
    expect(filterRows(rows, 'new').map((row) => row.mission.id)).toEqual(['new']);
    expect(filterRows(rows, 'overdue').map((row) => row.mission.id)).toEqual(['late']);
  });
});

describe('late days', () => {
  test('counts whole days between the due date and the moment of the read', () => {
    expect(daysLate('2026-10-01T12:00:00Z', observedAt)).toBe(36);
    expect(lateLabel('2026-10-01T12:00:00Z', observedAt)).toBe('36 days late');
    expect(lateLabel('2026-11-05T11:00:00Z', observedAt)).toBe('1 day late');
  });

  test('says "Due today" within the first day and "Late" when this clock has not reached the due time', () => {
    expect(lateLabel('2026-11-06T08:00:00Z', observedAt)).toBe('Due today');
    expect(lateLabel('2026-11-06T13:00:00Z', observedAt)).toBe('Late');
  });
});

describe('counts and summary', () => {
  test('says no mission needs you when both reads are empty', () => {
    const summary = needsSummary(page([]), page([]), []);
    expect(summary).toEqual({ lead: 'No missions need you now.', detail: '' });
  });

  test('says all are new and late when every mission is both', () => {
    const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
      mission(id, 'DRAFT', '2026-10-20T00:00:00Z'),
    );
    const rows = needsYouNow(page(all), page(all));
    expect(needsSummary(page(all), page(all), rows)).toEqual({
      lead: '6 missions need you.',
      detail: 'All 6 are new and past their due date.',
    });
  });

  test('uses the singular for one mission', () => {
    const one = [mission('a', 'DRAFT', '2026-12-01T00:00:00Z')];
    expect(needsSummary(page(one), page([]), needsYouNow(page(one), page([])))).toEqual({
      lead: '1 mission needs you.',
      detail: 'It is a new request.',
    });
    const late = [mission('b', 'OUTREACH', '2026-10-01T00:00:00Z')];
    expect(needsSummary(page([]), page(late), needsYouNow(page([]), page(late))).detail).toBe(
      'It is past its due date.',
    );
    expect(needsSummary(page(late), page(late), needsYouNow(page(late), page(late))).detail).toBe(
      'It is new and past its due date.',
    );
  });

  test('gives each part its own count when the missions are mixed', () => {
    const fresh = page([mission('n', 'DRAFT', '2026-12-01T00:00:00Z')]);
    const overdue = page([
      mission('l1', 'OUTREACH', '2026-10-01T00:00:00Z'),
      mission('l2', 'FOLLOW_UP', '2026-10-02T00:00:00Z'),
    ]);
    expect(needsSummary(fresh, overdue, needsYouNow(fresh, overdue))).toEqual({
      lead: '3 missions need you.',
      detail: '1 is new and 2 are past their due date.',
    });
  });

  test('says "At least" and never adds the totals when not every row was loaded', () => {
    const shared = mission('s', 'DRAFT', '2026-10-01T00:00:00Z');
    const fresh = page([shared], 4);
    const overdue = page([shared, mission('l', 'OUTREACH', '2026-10-02T00:00:00Z')], 9);
    const rows = needsYouNow(fresh, overdue);
    expect(needsCount(fresh, overdue, rows)).toEqual({ count: 9, exact: false });
    expect(needsSummary(fresh, overdue, rows)).toEqual({
      lead: 'At least 9 missions need you.',
      detail: '4 are new and 9 are past their due date.',
    });
    expect(filterTotal('new', fresh, overdue, rows)).toEqual({ count: 4, exact: true });
    expect(filterTotal('overdue', fresh, overdue, rows)).toEqual({ count: 9, exact: true });
    expect(filterTotal('all', fresh, overdue, rows)).toEqual({ count: 9, exact: false });
  });
});
