import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { connection, fixture, sandbox } from './support';
import { Pool, purgeIntakeRateLimit } from '../../packages/db/src/index';
import { migrate } from '../../packages/db/src/migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { MissionService } from '../../packages/missions/src/index';
import { CommunicationService } from '../../packages/communications/src/index';
import { DeliveryService } from '../../packages/delivery/src/index';
import { HelperInterestService } from '../../packages/auth/src/helper-interest';

// Core migration 0030: a rate limit key more than two hours old is removed by app.intake_rate_limit_purge(), which every public form
// runs as its own statement after its budget query. A row that old has no effect (the next call resets it to 1), so removing it
// must change no answer. The budget functions themselves are not replaced. Each test below fails on a database without 0030.
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
const purge = async () =>
  (await f.runtime.query('SELECT app.intake_rate_limit_purge() AS n')).rows[0].n as number;
const old = (hours: number) => `now()-interval '${hours} hours'`;
async function seedStale(label: string, n: number, hours = 5) {
  await f.owner.query(
    `INSERT INTO app.intake_rate_limit SELECT encode(sha256(convert_to($1||g::text,'UTF8')),'hex'),${old(hours)},7 FROM generate_series(1,$2) g`,
    [label, n],
  );
}
const exists = async (k: string) =>
  Number(
    (await f.owner.query('SELECT count(*) n FROM app.intake_rate_limit WHERE key=$1', [k])).rows[0]
      .n,
  ) === 1;

beforeAll(async () => {
  f = await fixture();
}, 120000);
afterAll(async () => {
  await f?.close();
});

describe('the purge removes keys more than two hours old and nothing else', () => {
  test('a stale key is removed; keys of the current hour, the previous hour and 119 minutes ago are untouched', async () => {
    await f.owner.query('DELETE FROM app.intake_rate_limit');
    const stale = key('stale-121-minutes');
    const recent = key('recent-119-minutes');
    const previous = key('previous-hour');
    const current = key('current-hour');
    await f.owner.query(
      `INSERT INTO app.intake_rate_limit VALUES($1,now()-interval '121 minutes',9),($2,now()-interval '119 minutes',8),($3,date_trunc('hour',now())-interval '1 hour',5),($4,date_trunc('hour',now()),2)`,
      [stale, recent, previous, current],
    );
    const before = await Promise.all([recent, previous, current].map(row));
    expect(await purge()).toBe(1);
    expect(await exists(stale)).toBe(false);
    const after = await Promise.all([recent, previous, current].map(row));
    expect(after).toEqual(before);
  });

  test('it removes at most 500 rows a call (1100 rows go in three calls) and returns how many it removed', async () => {
    await f.owner.query('DELETE FROM app.intake_rate_limit');
    await seedStale('batch-', 1100);
    const fresh = key('batch-fresh');
    await f.owner.query(
      "INSERT INTO app.intake_rate_limit VALUES($1,now()-interval '30 minutes',3)",
      [fresh],
    );
    expect(await purge()).toBe(500);
    expect(await count()).toBe(601);
    expect(await purge()).toBe(500);
    expect(await purge()).toBe(100);
    expect(await purge()).toBe(0);
    expect(await count()).toBe(1);
    expect((await row(fresh)).count).toBe(3);
  });

  test('it never waits: a row another transaction holds is skipped and the rest are removed at once', async () => {
    await f.owner.query('DELETE FROM app.intake_rate_limit');
    await seedStale('held-', 5);
    const held = key('held-held');
    await f.owner.query(`INSERT INTO app.intake_rate_limit VALUES($1,${old(6)},4)`, [held]);
    const holder = await f.owner.connect();
    try {
      await holder.query('BEGIN');
      // This is what a budget call does to its own key just before a purge from another request runs.
      await holder.query('SELECT 1 FROM app.intake_rate_limit WHERE key=$1 FOR UPDATE', [held]);
      // Without SKIP LOCKED the purge would wait here until the holder commits; the race turns that into a clean failure.
      const running = purge();
      const result = await Promise.race([
        running,
        new Promise<string>((resolve) => setTimeout(() => resolve('waited'), 2000)),
      ]);
      const heldStillThere = await exists(held);
      await holder.query('COMMIT');
      await running;
      expect(result).toBe(5);
      expect(heldStillThere).toBe(true);
    } finally {
      holder.release();
    }
    expect(await purge()).toBe(1);
  });

  test('a stale row of a caller still resets to 1 exactly as before, and the 6 and 60 limits are unchanged', async () => {
    const k = key('returning-key');
    await f.owner.query(`INSERT INTO app.intake_rate_limit VALUES($1,${old(3)},9)`, [k]);
    expect(await budget(k, 6)).toBe(true);
    expect((await row(k)).count).toBe(1);
    const six = key('six');
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await budget(six, 6));
    expect(results).toEqual([true, true, true, true, true, true, false]);
    const sixty = key('sixty');
    let allowed = 0;
    for (let i = 0; i < 61; i++) if (await budget(sixty, 60)) allowed++;
    expect(allowed).toBe(60);
    await expect(budget('not-a-hash', 6)).rejects.toThrow('Invalid budget');
    await expect(budget(key('x'), 5)).rejects.toThrow('Invalid budget');
  });

  test('app.intake_budget is not replaced and does not delete anything', async () => {
    const def = (
      await f.owner.query(
        "SELECT pg_get_functiondef('app.intake_budget(text,integer)'::regprocedure) d",
      )
    ).rows[0].d as string;
    expect(def).not.toMatch(/DELETE/i);
    expect(def).toContain("date_trunc('hour',now())");
    await f.owner.query('DELETE FROM app.intake_rate_limit');
    await seedStale('untouched-', 3);
    await budget(key('caller'), 6);
    expect(await count()).toBe(4); // the budget call removes nothing: only the purge does
  });
});

describe('no deadlock', () => {
  test('a purge between two open budget transactions neither waits nor fails, and both commit', async () => {
    await f.owner.query('DELETE FROM app.intake_rate_limit');
    const ka = key('interleave-a');
    const kb = key('interleave-b');
    await f.owner.query(
      `INSERT INTO app.intake_rate_limit VALUES($1,${old(5)},3),($2,${old(5)},3)`,
      [ka, kb],
    );
    await seedStale('interleave-other-', 20);
    const a = await f.runtime.connect();
    const b = await f.runtime.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      expect((await a.query('SELECT app.intake_budget($1,6) ok', [ka])).rows[0].ok).toBe(true);
      expect((await b.query('SELECT app.intake_budget($1,6) ok', [kb])).rows[0].ok).toBe(true);
      // Both own keys are locked and not yet committed; the purge from a third request skips them and does not wait.
      expect(await purge()).toBe(20);
      await a.query('COMMIT');
      await b.query('COMMIT');
    } finally {
      a.release();
      b.release();
    }
    expect((await row(ka)).count).toBe(1);
    expect((await row(kb)).count).toBe(1);
  });

  test('30 parallel callers, each a budget statement and then the purge, over 600 stale keys: zero errors, every stale key gone', async () => {
    const wide = new Pool({
      ...connection('corridra_integration', 'corridra_runtime_local', sandbox.runtimePassword),
      max: 30,
    });
    try {
      const failures: string[] = [];
      for (let round = 0; round < 25; round++) {
        await f.owner.query('DELETE FROM app.intake_rate_limit');
        await seedStale('rollover-', 600);
        const k = (i: number) => key('rollover-' + (i + 1));
        const results = await Promise.all(
          Array.from({ length: 30 }, (_, i) =>
            // Two keys in one statement, always in ascending order, as the public forms do; the keys are inside the stale set so
            // the budget upserts and the purge deletes meet on the same rows.
            wide
              .query('SELECT app.intake_budget($1,60) a,app.intake_budget($2,60) b', [
                k(i * 3),
                k(i * 3 + 1),
              ])
              .then(
                () => purgeIntakeRateLimit(wide).then(() => 'ok'),
                (e: { code?: string; message?: string }) => `${e.code}: ${e.message}`,
              ),
          ),
        );
        for (const r of results) if (r !== 'ok') failures.push(r);
        // The purge is best effort and bounded; a few more calls clear the rest, never an error.
        for (let i = 0; i < 3; i++) await purgeIntakeRateLimit(wide);
        const left = Number(
          (
            await f.owner.query(
              "SELECT count(*) n FROM app.intake_rate_limit WHERE window_start<now()-interval '2 hours'",
            )
          ).rows[0].n,
        );
        if (left !== 0) failures.push(`${left} stale rows left in round ${round}`);
      }
      expect(failures).toEqual([]);
    } finally {
      await wide.end();
    }
  }, 300000);
});

describe('every form runs the purge after its budget query', () => {
  const stalePlanted = async () => {
    await f.owner.query('DELETE FROM app.intake_rate_limit');
    await seedStale('caller-stale-', 4);
  };
  const noStale = async () =>
    Number(
      (
        await f.owner.query(
          "SELECT count(*) n FROM app.intake_rate_limit WHERE window_start<now()-interval '2 hours'",
        )
      ).rows[0].n,
    ) === 0;

  test('mission intake (sample mode)', async () => {
    await stalePlanted();
    await new MissionService(f.runtime, 'purge-secret').budget('203.0.113.7');
    expect(await noStale()).toBe(true);
  });

  test('buyer replies (communications)', async () => {
    await stalePlanted();
    await new CommunicationService(f.runtime, 'purge-secret').budget('client', 'token');
    expect(await noStale()).toBe(true);
  });

  test('delivery links', async () => {
    await stalePlanted();
    await new DeliveryService(
      f.runtime,
      new MissionService(f.runtime, 'purge-secret'),
      'purge-secret',
    ).budget('client', 'token');
    expect(await noStale()).toBe(true);
  });

  test('the helper interest form (both of its budget statements)', async () => {
    await stalePlanted();
    await new HelperInterestService(f.runtime, 'purge-secret').globalBudget();
    expect(await noStale()).toBe(true);
    await stalePlanted();
    await expect(
      new HelperInterestService(f.runtime, 'purge-secret').submit({
        name: 'Test Person',
        email: 'nobody-budget@example.test',
        country: 'BD',
        reason: 'I would like to help the network.',
        website: '',
      }),
    ).rejects.toBeDefined(); // the register module is not installed here; the budget query and purge run first
    expect(await noStale()).toBe(true);
  });

  test('real mode intake, which writes the same table through customer.real_request_budget', async () => {
    await migrateCustomerRealUse(f.owner);
    const tenant = randomUUID();
    await f.owner.query(
      "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'Purge test real workspace',false)",
      [tenant],
    );
    await f.owner.query(
      "INSERT INTO customer_private.real_use_configuration(issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled) VALUES($1,$2,$3,$4,'real-intake-2026-10-21-v1',true)",
      [
        'https://ep-purge-fixture.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth',
        f.serviceId,
        tenant,
        f.users.owner.id,
      ],
    );
    await stalePlanted();
    const current = key('real-current');
    await f.owner.query("INSERT INTO app.intake_rate_limit VALUES($1,date_trunc('hour',now()),2)", [
      current,
    ]);
    const before = await row(current);
    await new MissionService(f.runtime, 'purge-secret', 'real').budget('203.0.113.9');
    expect(await noStale()).toBe(true);
    const after = await row(current);
    expect(after.count).toBe(2);
    expect(after.window_start.getTime()).toBe(before.window_start.getTime());
  });

  test('an error from the purge never changes an answer, and a budget over its limit is still refused', async () => {
    const failing = {
      query: (sql: string, params?: unknown[]) =>
        sql.includes('intake_rate_limit_purge')
          ? Promise.reject(new Error('purge failed'))
          : f.runtime.query(sql, params),
    } as unknown as typeof f.runtime;
    const service = new MissionService(failing, 'purge-failing-secret');
    for (let i = 0; i < 6; i++) await service.budget('198.51.100.1');
    await expect(service.budget('198.51.100.1')).rejects.toMatchObject({ status: 429 });
  });
});

describe('what did not change', () => {
  test('the purge is security definer with a fixed search path, executable by the runtime login only', async () => {
    const fn = (
      await f.owner.query(
        "SELECT prosecdef,proconfig,prorettype::regtype::text ret FROM pg_proc WHERE oid='app.intake_rate_limit_purge()'::regprocedure",
      )
    ).rows[0];
    expect(fn.prosecdef).toBe(true);
    expect(fn.proconfig).toEqual(['search_path=pg_catalog']);
    expect(fn.ret).toBe('integer');
    const can = async (role: string, sig: string) =>
      (await f.owner.query("SELECT has_function_privilege($1,$2,'EXECUTE') ok", [role, sig]))
        .rows[0].ok;
    expect(await can('corridra_runtime', 'app.intake_rate_limit_purge()')).toBe(true);
    expect(await can('corridra_auth', 'app.intake_rate_limit_purge()')).toBe(false);
    expect(await can('public', 'app.intake_rate_limit_purge()')).toBe(false);
    // The budget function keeps its grants from 0007.
    expect(await can('corridra_runtime', 'app.intake_budget(text,integer)')).toBe(true);
    expect(await can('corridra_auth', 'app.intake_budget(text,integer)')).toBe(false);
    expect(await can('public', 'app.intake_budget(text,integer)')).toBe(false);
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
  test('applying 0030 purges rows more than two hours old, keeps newer ones, adds the index and leaves the budget function as it was', async () => {
    const prior = await fixture('corridra_upgrade', '0029_identity_password_audit.sql');
    try {
      const a = key('upgrade-stale');
      const b = key('upgrade-current');
      const c = key('upgrade-90-minutes');
      await prior.owner.query(
        `INSERT INTO app.intake_rate_limit VALUES($1,${old(5)},4),($2,date_trunc('hour',now()),2),($3,now()-interval '90 minutes',6)`,
        [a, b, c],
      );
      const definition = async () =>
        (
          await prior.owner.query(
            "SELECT pg_get_functiondef('app.intake_budget(text,integer)'::regprocedure) d",
          )
        ).rows[0].d as string;
      const before = await definition();
      // Before 0030 the purge does not exist and a form still works (the purge is best effort).
      await new MissionService(prior.runtime, 'upgrade-secret').budget('203.0.113.1');
      await migrate(prior.owner);
      const left = (await prior.owner.query('SELECT key,count FROM app.intake_rate_limit')).rows;
      expect(left.some((r: { key: string }) => r.key === a)).toBe(false);
      expect(left.find((r: { key: string }) => r.key === b).count).toBe(2);
      expect(left.find((r: { key: string }) => r.key === c).count).toBe(6);
      expect(
        (
          await prior.owner.query(
            "SELECT count(*) n FROM pg_indexes WHERE schemaname='app' AND tablename='intake_rate_limit' AND indexname='intake_rate_limit_window'",
          )
        ).rows[0].n,
      ).toBe('1');
      expect(await definition()).toBe(before);
      expect(
        (await prior.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n,
      ).toBe(30);
    } finally {
      await prior.close();
    }
  });

  test('0030 refuses to run without the budget table and function it belongs to, and leaves 29 applied', async () => {
    const prior = await fixture('corridra_upgrade', '0029_identity_password_audit.sql');
    try {
      await prior.owner.query('DROP FUNCTION app.intake_budget(text,integer)');
      await expect(migrate(prior.owner)).rejects.toThrow('Intake budget prerequisite is missing');
      expect(
        (await prior.owner.query('SELECT count(*)::int n FROM migrations.applied')).rows[0].n,
      ).toBe(29);
    } finally {
      await prior.close();
    }
  });
});
