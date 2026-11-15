import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connection, fixture, sandbox } from './support';
import { Pool } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';

// Core migration 0030: a rate limit key no longer outlives its hour. A row of an earlier hour has no effect (the next call resets
// it to 1), so removing it must change no answer. Each test below fails on a database without 0030.
const key = (label: string) => createHash('sha256').update(label).digest('hex');
let f: Awaited<ReturnType<typeof fixture>>;
const count = async () =>
  Number((await f.owner.query('SELECT count(*) n FROM app.intake_rate_limit')).rows[0].n);
const row = async (k: string) =>
  (
    await f.owner.query('SELECT key,count,window_start FROM app.intake_rate_limit WHERE key=$1', [
      k,
    ])
  ).rows[0];
const budget = async (k: string, max: number) =>
  (await f.runtime.query('SELECT app.intake_budget($1,$2) AS ok', [k, max])).rows[0].ok as boolean;
const staleHour = (hours: number) => `date_trunc('hour',now())-interval '${hours} hours'`;
async function seedStale(label: string, n: number, hours = 2) {
  await f.owner.query(
    `INSERT INTO app.intake_rate_limit SELECT encode(sha256(convert_to($1||g::text,'UTF8')),'hex'),${staleHour(hours)},7 FROM generate_series(1,$2) g`,
    [label, n],
  );
}

beforeAll(async () => {
  f = await fixture();
}, 120000);
afterAll(async () => {
  await f?.close();
});

describe('stale keys leave the table', () => {
  test('a key of an earlier hour is gone after the next call, and a key of the current hour is untouched', async () => {
    await seedStale('old-key-', 3);
    const current = key('current-hour-key');
    expect(await budget(current, 6)).toBe(true);
    expect(await budget(current, 6)).toBe(true);
    const before = await row(current);
    expect(before.count).toBe(2);
    await budget(key('another-caller'), 6);
    expect(await count()).toBe(2); // the current key and the caller just counted; no stale row is left
    const after = await row(current);
    expect(after.count).toBe(2);
    expect(after.window_start.getTime()).toBe(before.window_start.getTime());
    const stale = await f.owner.query(
      "SELECT count(*) n FROM app.intake_rate_limit WHERE window_start<date_trunc('hour',now())",
    );
    expect(Number(stale.rows[0].n)).toBe(0);
  });

  test('a stale row of the caller itself still resets to 1, exactly as before', async () => {
    const k = key('returning-key');
    await f.owner.query(`INSERT INTO app.intake_rate_limit VALUES($1,${staleHour(3)},9)`, [k]);
    expect(await budget(k, 6)).toBe(true);
    expect((await row(k)).count).toBe(1);
  });

  test('the limits are unchanged: 6 allows six calls and refuses the seventh, 60 allows sixty and refuses the sixty first', async () => {
    const six = key('six');
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await budget(six, 6));
    expect(results).toEqual([true, true, true, true, true, true, false]);
    const sixty = key('sixty');
    let allowed = 0;
    for (let i = 0; i < 61; i++) if (await budget(sixty, 60)) allowed++;
    expect(allowed).toBe(60);
  });

  test('a bad key or a maximum other than 6 and 60 is still refused, and refused before anything is deleted', async () => {
    await seedStale('refused-', 5);
    const before = await count();
    await expect(budget('not-a-hash', 6)).rejects.toThrow('Invalid budget');
    await expect(budget(key('x'), 5)).rejects.toThrow('Invalid budget');
    await expect(budget(key('x').toUpperCase(), 6)).rejects.toThrow('Invalid budget');
    expect(await count()).toBe(before);
  });

  test('each call removes at most 500 stale rows, and the rest go on the next calls', async () => {
    await f.owner.query('DELETE FROM app.intake_rate_limit');
    await seedStale('batch-', 1100);
    await budget(key('batch-caller'), 6);
    expect(await count()).toBe(1100 - 500 + 1);
    await budget(key('batch-caller'), 6);
    expect(await count()).toBe(1100 - 1000 + 1);
    await budget(key('batch-caller'), 6);
    expect(await count()).toBe(1);
  });
});

describe('concurrent calls at an hour rollover', () => {
  test('many callers whose own counters are stale, with a backlog of stale counters, never deadlock or fail', async () => {
    // Thirty connections call at once right after an hour ends, each with its own stale counter inside a backlog larger than one
    // cleanup batch. Cleaning before counting let two calls each lock the other's stale counter and then wait on each other (40P01).
    const wide = new Pool({
      ...connection('corridra_integration', 'corridra_runtime_local', sandbox.runtimePassword),
      max: 30,
    });
    try {
      const failures: string[] = [];
      for (let round = 0; round < 60; round++) {
        await f.owner.query('DELETE FROM app.intake_rate_limit');
        await seedStale('rollover-', 1500);
        const results = await Promise.all(
          Array.from({ length: 30 }, (_, i) =>
            wide
              .query('SELECT app.intake_budget($1,6) AS ok', [
                createHash('sha256')
                  .update('rollover-' + (i * 41 + 1 + round))
                  .digest('hex'),
              ])
              .then(
                (r) => (r.rows[0].ok === true ? 'ok' : 'refused'),
                (e: { code?: string; message?: string }) => `${e.code}: ${e.message}`,
              ),
          ),
        );
        for (const r of results) if (r !== 'ok') failures.push(r);
      }
      expect(failures).toEqual([]);
    } finally {
      await wide.end();
    }
  }, 300000);
});

describe('what did not change', () => {
  test('the function is still security definer with a fixed search path, executable by the runtime login only', async () => {
    const fn = (
      await f.owner.query(
        "SELECT prosecdef,proconfig,pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid='app.intake_budget(text,integer)'::regprocedure",
      )
    ).rows[0];
    expect(fn.prosecdef).toBe(true);
    expect(fn.proconfig).toEqual(['search_path=pg_catalog']);
    const can = async (role: string) =>
      (
        await f.owner.query(
          "SELECT has_function_privilege($1,'app.intake_budget(text,integer)','EXECUTE') ok",
          [role],
        )
      ).rows[0].ok;
    expect(await can('corridra_runtime')).toBe(true);
    expect(await can('corridra_auth')).toBe(false);
    expect(await can('public')).toBe(false);
  });

  test('the runtime and auth logins still cannot read or write the table directly', async () => {
    for (const pool of [f.runtime, f.auth]) {
      await expect(pool.query('SELECT * FROM app.intake_rate_limit')).rejects.toThrow();
      await expect(pool.query('DELETE FROM app.intake_rate_limit')).rejects.toThrow();
    }
  });

  test('the only rows ever kept are 64 character hex keys', async () => {
    const keys = (await f.owner.query('SELECT key FROM app.intake_rate_limit')).rows.map(
      (r: { key: string }) => r.key,
    );
    expect(keys.every((k: string) => /^[a-f0-9]{64}$/.test(k))).toBe(true);
  });
});

describe('the upgrade from the 29 migrations in production', () => {
  test('applying 0030 purges the rows that are already stale, keeps the current hour, and adds the index', async () => {
    const old = await fixture('corridra_upgrade', '0029_identity_password_audit.sql');
    try {
      const a = key('upgrade-stale');
      const b = key('upgrade-current');
      await old.owner.query(
        `INSERT INTO app.intake_rate_limit VALUES($1,${staleHour(5)},4),($2,date_trunc('hour',now()),2)`,
        [a, b],
      );
      // Before 0030 an ordinary call leaves the stale row where it is.
      await old.runtime.query('SELECT app.intake_budget($1,6)', [key('upgrade-caller')]);
      expect(
        Number(
          (await old.owner.query('SELECT count(*) n FROM app.intake_rate_limit WHERE key=$1', [a]))
            .rows[0].n,
        ),
      ).toBe(1);
      await migrate(old.owner);
      const left = (await old.owner.query('SELECT key,count FROM app.intake_rate_limit')).rows;
      expect(left.some((r: { key: string }) => r.key === a)).toBe(false);
      expect(left.find((r: { key: string }) => r.key === b).count).toBe(2);
      expect(
        (
          await old.owner.query(
            "SELECT count(*) n FROM pg_indexes WHERE schemaname='app' AND tablename='intake_rate_limit' AND indexname='intake_rate_limit_window'",
          )
        ).rows[0].n,
      ).toBe('1');
      expect(
        (await old.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n,
      ).toBe(30);
    } finally {
      await old.close();
    }
  });

  test('0030 refuses to replace a function whose reviewed definition has changed', async () => {
    const old = await fixture('corridra_upgrade', '0029_identity_password_audit.sql');
    try {
      await old.owner.query(
        'CREATE OR REPLACE FUNCTION app.intake_budget(k text,maximum integer) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT true $$',
      );
      await expect(migrate(old.owner)).rejects.toThrow('Reviewed intake budget baseline differs');
      expect(
        (await old.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n,
      ).toBe(29);
    } finally {
      await old.close();
    }
  });
});
