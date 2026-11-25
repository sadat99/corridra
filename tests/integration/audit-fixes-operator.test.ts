import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { quietLabel } from '../../apps/web/app/operator/[section]/[missionId]/mission-labels';

// Audit fixes 1, staff words (items 9 and 12). The layout items are covered in
// tests/operator/audit-fixes-operator-ui.spec.ts.
const now = Date.parse('2026-11-12T12:00:00Z');
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();
// The operations screen is a client component (TSX); load it the way the other screen tests do.
const { showRowsLabel } = (await import(
  /* @vite-ignore */ `../../apps/web/app/operator/${'operations.tsx'}`
)) as { showRowsLabel: (all: boolean, limit: number, total: number) => string };

describe('operations table rows button', () => {
  it('counts every row in Title Case while folded', () => {
    expect(showRowsLabel(false, 1, 11)).toBe('Show All 11 Rows');
    expect(showRowsLabel(false, 3, 5)).toBe('Show All 5 Rows');
  });
  it('says "row" for a single first row and "rows" for more', () => {
    expect(showRowsLabel(true, 1, 11)).toBe('Show the First Row');
    expect(showRowsLabel(true, 3, 5)).toBe('Show the First 3 Rows');
  });
});

describe('mission quiet label', () => {
  it('says when the mission last changed, never a second count of days late', () => {
    expect(quietLabel(daysAgo(37), now)).toBe('Last changed 37 days ago');
    expect(quietLabel(daysAgo(1), now)).toBe('Last changed 1 day ago');
  });
  it('is the only quiet wording on the missions queue and mission card', () => {
    const source = readFileSync('apps/web/app/operator/missions.tsx', 'utf8');
    expect(source).not.toContain('No mission update in');
    // The queue row, the mission card facts and the same facts in the team desk v4.1 groups.
    expect(source.match(/quietLabel\(m\.updated_at\)/g)).toHaveLength(3);
  });
});
