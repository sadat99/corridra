import { describe, expect, it } from 'vitest';
import {
  isStale,
  latestHandover,
  quietDays,
  staleAfterDays,
} from '../../apps/web/app/operator/[section]/[missionId]/mission-labels';

const now = Date.parse('2026-11-12T12:00:00Z');
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

describe('stale missions', () => {
  it('flags an open mission with no change for the limit', () => {
    expect(isStale(daysAgo(staleAfterDays), 'ACTIVE', now)).toBe(true);
    expect(isStale(daysAgo(staleAfterDays - 1), 'ACTIVE', now)).toBe(false);
  });
  it('never flags closed, cancelled or paused missions or missing stamps', () => {
    for (const status of ['CLOSED', 'CANCELLED', 'ON_HOLD'])
      expect(isStale(daysAgo(30), status, now)).toBe(false);
    expect(isStale(undefined, 'ACTIVE', now)).toBe(false);
    expect(isStale('not a date', 'ACTIVE', now)).toBe(false);
  });
  it('counts whole days', () => {
    expect(quietDays(daysAgo(9), now)).toBe(9);
  });
});

describe('latest hand-over', () => {
  const row = (ownerId: string, reason: string, at: number) => ({
    reason,
    created_at: daysAgo(at),
    details: { ownerId },
  });
  it('reads the reason of the newest owner change', () => {
    const history = [
      row('b', 'Later change by the new owner', 1),
      row('b', 'Noor takes over, supplier call is Friday', 3),
      row('a', 'Moved the date', 4),
      row('a', 'Started', 5),
    ];
    const found = latestHandover(history);
    expect(found?.entry.reason).toBe('Noor takes over, supplier call is Friday');
    expect(found?.fromOwnerId).toBe('a');
    expect(found?.toOwnerId).toBe('b');
  });
  it('is null while the owner never changed', () => {
    expect(latestHandover([row('a', 'Two', 2), row('a', 'One', 3)])).toBeNull();
    expect(latestHandover([])).toBeNull();
  });
});
