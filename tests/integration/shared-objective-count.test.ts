import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseSharedObjectiveCount,
  sharedObjectiveCountLine,
} from '../../apps/web/lib/shared-objective-count';

// The organiser's "Plan the days" step shows how many delegates share an objective summary. Count only.
test('only a single non-negative integer is read; anything else is unknown, never zero', () => {
  expect(parseSharedObjectiveCount({ count: 0 })).toBe(0);
  expect(parseSharedObjectiveCount({ count: 7 })).toBe(7);
  for (const bad of [
    null,
    undefined,
    [],
    'x',
    {},
    { count: -1 },
    { count: 1.5 },
    { count: '3' },
    { count: 3, kind: 'Source suppliers' },
    { count: 3, byKind: { sell: 3 } },
  ])
    expect(parseSharedObjectiveCount(bad)).toBeNull();
});

test('the line is plain, singular where it should be, and has no dash', () => {
  expect(sharedObjectiveCountLine(0)).toBe('No delegate has shared an objective summary yet.');
  expect(sharedObjectiveCountLine(1)).toBe('1 delegate has shared an objective summary with you.');
  expect(sharedObjectiveCountLine(12)).toBe(
    '12 delegates have shared an objective summary with you.',
  );
  for (const n of [0, 1, 12]) expect(sharedObjectiveCountLine(n)).not.toMatch(/[–—]/);
});

test('the room shows it in the plan step only while shared objectives are on, and asks for no kind', () => {
  const room = readFileSync('apps/web/app/account/delegations/customer-programmes.tsx', 'utf8');
  expect(room).toMatch(/missionSharesEnabled && \(\s*<ProgrammeSharedObjectiveCount/);
  const part = readFileSync(
    'apps/web/app/account/delegations/programme-shared-objective-count.tsx',
    'utf8',
  );
  expect(part).toContain("view: 'count'");
  expect(part).not.toMatch(/objective(Kind|Type)|byKind|customer_private/);
});
