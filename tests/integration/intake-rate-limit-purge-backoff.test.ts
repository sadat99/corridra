import { describe, expect, test } from 'vitest';
import { purgeIntakeRateLimit, purgeMissingBackoffMs } from '../../packages/db/src/index';

// Before core 0030 is installed the purge function does not exist (42883). pg-pool throws away a connection that returns any error,
// so the purge must not be tried on every request until the install. These tests use a stub pool: no database is needed.
const stub = (failWith?: { code?: string }) => {
  const calls: string[] = [];
  return {
    calls,
    query: async (sql: string) => {
      calls.push(sql);
      if (failWith) throw Object.assign(new Error('purge failed'), failWith);
      return { rows: [{ n: 0 }] };
    },
  };
};
type PurgePool = Parameters<typeof purgeIntakeRateLimit>[0];
const asPool = (p: { query: unknown }) => p as unknown as PurgePool;

describe('purgeIntakeRateLimit when the purge function is not installed yet', () => {
  test('after one 42883 it skips the purge for ten minutes, then tries again', async () => {
    const pool = stub({ code: '42883' });
    let clock = 1_000_000;
    const now = () => clock;
    await purgeIntakeRateLimit(asPool(pool), now);
    expect(pool.calls).toHaveLength(1);
    await purgeIntakeRateLimit(asPool(pool), now);
    clock += purgeMissingBackoffMs - 1;
    await purgeIntakeRateLimit(asPool(pool), now);
    expect(pool.calls).toHaveLength(1);
    clock += 1;
    await purgeIntakeRateLimit(asPool(pool), now);
    expect(pool.calls).toHaveLength(2);
    await purgeIntakeRateLimit(asPool(pool), now);
    expect(pool.calls).toHaveLength(2);
  });

  test('once the function exists the purge runs on every call again', async () => {
    let installed = false;
    const calls: string[] = [];
    const pool = {
      query: async (sql: string) => {
        calls.push(sql);
        if (!installed) throw Object.assign(new Error('no function'), { code: '42883' });
        return { rows: [{ n: 0 }] };
      },
    };
    let clock = 5_000_000;
    const now = () => clock;
    await purgeIntakeRateLimit(asPool(pool), now);
    installed = true;
    clock += purgeMissingBackoffMs;
    await purgeIntakeRateLimit(asPool(pool), now);
    await purgeIntakeRateLimit(asPool(pool), now);
    await purgeIntakeRateLimit(asPool(pool), now);
    expect(calls).toHaveLength(4);
  });

  test('any other error is swallowed and does not start a pause', async () => {
    const pool = stub({ code: '57P01' });
    await expect(purgeIntakeRateLimit(asPool(pool), () => 10)).resolves.toBeUndefined();
    await purgeIntakeRateLimit(asPool(pool), () => 11);
    await purgeIntakeRateLimit(asPool(pool), () => 12);
    expect(pool.calls).toHaveLength(3);
    const plain = stub({});
    await expect(purgeIntakeRateLimit(asPool(plain), () => 10)).resolves.toBeUndefined();
    await purgeIntakeRateLimit(asPool(plain), () => 11);
    expect(plain.calls).toHaveLength(2);
  });

  test('the pause belongs to one pool and a pool that works is never paused', async () => {
    const missing = stub({ code: '42883' });
    const working = stub();
    const now = () => 42;
    await purgeIntakeRateLimit(asPool(missing), now);
    await purgeIntakeRateLimit(asPool(working), now);
    await purgeIntakeRateLimit(asPool(working), now);
    expect(missing.calls).toHaveLength(1);
    expect(working.calls).toHaveLength(2);
    expect(working.calls[0]).toBe('SELECT app.intake_rate_limit_purge()');
  });
});
