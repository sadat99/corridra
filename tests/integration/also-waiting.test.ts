import { describe, expect, test } from 'vitest';
import {
  alsoWaitingReads,
  capOverdue,
  erasureTile,
  overdueChip,
  problemReportsTile,
} from '../../apps/web/lib/ux/also-waiting';

// Mandate F (11 Nov 2026): Today shows problem reports and erasure requests only to the roles that already see the
// queues, shows nothing for a source that is not available, and lists overdue erasure requests by reference only.
const now = new Date('2026-11-11T12:00:00Z');
const item = (n: number, daysLeft: number, status = 'received') => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  number: n,
  reference: `ER-000${n}`,
  filedAt: '2026-10-01T00:00:00Z',
  dueAt: new Date(now.getTime() + daysLeft * 86_400_000).toISOString(),
  daysLeft,
  status,
  note: null,
  accountStatus: 'closed',
  closedAt: null,
  undoUntil: null,
});

describe('role gate', () => {
  test.each([
    ['owner', true, true],
    ['admin', true, true],
    ['operator', false, false],
    ['viewer', false, false],
    [undefined, false, false],
    [null, false, false],
  ])('%s starts reads: problem reports %s, erasure %s', (role, reports, erasure) => {
    expect(alsoWaitingReads(role, true)).toEqual({ problemReports: reports, erasure });
  });
  test('an operator never starts a read, whatever is installed', () => {
    expect(alsoWaitingReads('operator', true)).toEqual({ problemReports: false, erasure: false });
  });
  test('Report a Problem not installed: no problem report read for an owner, erasure still allowed', () => {
    expect(alsoWaitingReads('owner', false)).toEqual({ problemReports: false, erasure: true });
  });
});

describe('problem reports tile', () => {
  test('counts received and in review, with the oldest waiting age', () => {
    expect(
      problemReportsTile(
        {
          counts: { received: 2, in_review: 1, resolved: 9, closed: 4 },
          oldestReceivedAt: '2026-11-08T12:00:00Z',
        },
        now,
      ),
    ).toEqual({ count: 3, oldestAt: '2026-11-08T12:00:00Z', oldestDays: 3 });
  });
  test('a missing or malformed answer gives no tile, never zero', () => {
    expect(problemReportsTile(null, now)).toBeNull();
    expect(problemReportsTile({}, now)).toBeNull();
    expect(problemReportsTile({ counts: { received: 'x', in_review: 1 } }, now)).toBeNull();
  });
});

describe('erasure tile', () => {
  test('open count, overdue count and nearest due date; answered requests are not open', () => {
    const tile = erasureTile(
      [item(1, -3), item(2, 5), item(3, 12, 'in_progress'), item(4, -9, 'completed')],
      false,
    )!;
    expect(tile.count).toBe(3);
    expect(tile.overdue).toBe(1);
    expect(tile.nearestDueAt).toBe(item(1, -3).dueAt);
    expect(tile.rows.map((r) => r.reference)).toEqual(['ER-0001']);
  });
  test('a full page says at least; a malformed item gives no tile', () => {
    expect(erasureTile([item(1, 2)], true)!.atLeast).toBe(true);
    expect(erasureTile([{ id: 1 }], false)).toBeNull();
  });
  test('overdue rows are capped at 5 with the rest counted', () => {
    const rows = erasureTile(
      [1, 2, 3, 4, 5, 6, 7].map((n) => item(n, -n)),
      false,
    )!.rows;
    expect(rows[0]!.daysOverdue).toBe(7);
    expect(capOverdue(rows)).toMatchObject({ more: 2 });
    expect(capOverdue(rows).shown).toHaveLength(5);
    expect(overdueChip(1)).toBe('1 day overdue');
    expect(overdueChip(4)).toBe('4 days overdue');
  });
});

describe('privacy', () => {
  test('an overdue row carries the reference, days overdue and due date and no person or workspace field', () => {
    const leaky = {
      ...item(1, -3),
      name: 'Rafiq Hasan',
      email: 'rafiq@example.test',
      workspaceName: 'Synthetic Workspace Ltd',
      note: 'Rafiq Hasan asked on behalf of Synthetic Workspace Ltd',
    };
    const tile = erasureTile([leaky], false)!;
    expect(tile.rows).toEqual([
      { id: leaky.id, reference: 'ER-0001', daysOverdue: 3, dueAt: leaky.dueAt },
    ]);
    expect(JSON.stringify(tile)).not.toMatch(/Rafiq|example\.test|Synthetic Workspace/);
  });
});
