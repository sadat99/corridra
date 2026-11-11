import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DatabasePool } from '../../packages/db/src/index';
import {
  endMigrationRun,
  migrateOnce,
  startMigrationRun,
} from '../../packages/db/src/migration-run';

// No database: the memoisation only needs an object to key on.
const fakePool = () => ({}) as unknown as DatabasePool;
const pools: DatabasePool[] = [];
const pool = () => {
  const made = fakePool();
  pools.push(made);
  return made;
};
afterEach(() => {
  for (const made of pools.splice(0)) endMigrationRun(made);
});

describe('migrateOnce without a started run', () => {
  test('calls the function every time, so tests and the application behave as before', async () => {
    const p = pool();
    const body = vi.fn(async () => 'done');
    await migrateOnce(p, 'migrateA', body);
    await migrateOnce(p, 'migrateA', body);
    await migrateOnce(p, 'migrateA', body);
    expect(body).toHaveBeenCalledTimes(3);
  });

  test('passes a failure straight through', async () => {
    await expect(
      migrateOnce(pool(), 'migrateA', async () => {
        throw new Error('stopped');
      }),
    ).rejects.toThrow('stopped');
  });
});

describe('migrateOnce inside a started run', () => {
  test('runs a key once per pool and returns the first result to every caller', async () => {
    const p = pool();
    startMigrationRun(p);
    const body = vi.fn(async () => ({ value: 7 }));
    const first = await migrateOnce(p, 'migrateA', body);
    const second = await migrateOnce(p, 'migrateA', body);
    expect(body).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test('different keys each run once', async () => {
    const p = pool();
    startMigrationRun(p);
    const a = vi.fn(async () => 'a');
    const b = vi.fn(async () => 'b');
    expect(await migrateOnce(p, 'migrateA', a)).toBe('a');
    expect(await migrateOnce(p, 'migrateB', b)).toBe('b');
    await migrateOnce(p, 'migrateA', a);
    await migrateOnce(p, 'migrateB', b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test('two callers at the same moment share one execution', async () => {
    const p = pool();
    startMigrationRun(p);
    let release: () => void = () => {};
    const body = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve('shared');
        }),
    );
    const first = migrateOnce(p, 'migrateA', body);
    const second = migrateOnce(p, 'migrateA', body);
    release();
    expect(await Promise.all([first, second])).toEqual(['shared', 'shared']);
    expect(body).toHaveBeenCalledTimes(1);
  });

  test('two pools are independent, and a run started for one does not memoise the other', async () => {
    const started = pool();
    const other = pool();
    startMigrationRun(started);
    const body = vi.fn(async () => 'done');
    await migrateOnce(started, 'migrateA', body);
    await migrateOnce(other, 'migrateA', body);
    await migrateOnce(other, 'migrateA', body);
    await migrateOnce(started, 'migrateA', body);
    expect(body).toHaveBeenCalledTimes(3);
    startMigrationRun(other);
    await migrateOnce(other, 'migrateA', body);
    await migrateOnce(other, 'migrateA', body);
    expect(body).toHaveBeenCalledTimes(4);
  });

  test('a failure is not kept: the next call runs the body again and can succeed', async () => {
    const p = pool();
    startMigrationRun(p);
    let attempt = 0;
    const body = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('history mismatch');
      return 'recovered';
    });
    await expect(migrateOnce(p, 'migrateA', body)).rejects.toThrow('history mismatch');
    expect(await migrateOnce(p, 'migrateA', body)).toBe('recovered');
    expect(await migrateOnce(p, 'migrateA', body)).toBe('recovered');
    expect(body).toHaveBeenCalledTimes(2);
  });

  test('ending the run clears it, so later calls run again, and ending twice is harmless', async () => {
    const p = pool();
    startMigrationRun(p);
    const body = vi.fn(async () => 'done');
    await migrateOnce(p, 'migrateA', body);
    endMigrationRun(p);
    endMigrationRun(p);
    await migrateOnce(p, 'migrateA', body);
    await migrateOnce(p, 'migrateA', body);
    expect(body).toHaveBeenCalledTimes(3);
  });

  test('starting a run again begins with an empty memory', async () => {
    const p = pool();
    startMigrationRun(p);
    const body = vi.fn(async () => 'done');
    await migrateOnce(p, 'migrateA', body);
    startMigrationRun(p);
    await migrateOnce(p, 'migrateA', body);
    expect(body).toHaveBeenCalledTimes(2);
  });
});
