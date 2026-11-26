import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateRoutePack } from '../../packages/db/src/route-pack-migrate';

// ADR-093 Phase 2a, the database side of the install. app.guard_operations_control() is replaced once, hash-guarded, by an
// optional module. The only differences from the real-use 0003 definition are two dropped comparisons and two reworded
// messages; a marker tells the application the module is present.
let f: Awaited<ReturnType<typeof commercialFixture>>;
const registry = 'route_pack_migrations.applied';
const file = '0001_one_person_route_publication.sql';
const contentFile = '0002_route_pack_content.sql';
const dir = 'packages/db/route-pack-migrations';
const realUseHash = 'df18b4d178c4fc824869c924da7110ea802e7594681659dbabebe24950edbd97';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
async function guard() {
  return (
    await f.owner.query(
      "SELECT pg_get_functiondef('app.guard_operations_control()'::regprocedure) d,encode(sha256(convert_to(pg_get_functiondef('app.guard_operations_control()'::regprocedure),'UTF8')),'hex') h",
    )
  ).rows[0] as { d: string; h: string };
}
async function functionHashes() {
  const rows = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text AS name,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS hash
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.prokind='f' ORDER BY 1`,
    )
  ).rows as { name: string; hash: string }[];
  return new Map(rows.map((row) => [row.name, row.hash]));
}
const marker = async () =>
  (await f.owner.query("SELECT to_regprocedure('app.route_pack_one_person_publication()') r"))
    .rows[0].r;
const lastReturn = /RETURN NEW;(?![\s\S]*RETURN NEW;)/;
beforeAll(async () => {
  f = await commercialFixture();
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('the module will not install without the real-use modules and records nothing', async () => {
  await expect(migrateRoutePack(f.owner)).rejects.toThrow(
    'The customer real-use modules are not installed, so route pack publication was not installed. Run the real-use install first.',
  );
  expect(
    (await f.owner.query("SELECT to_regclass('route_pack_migrations.applied') r")).rows[0].r,
  ).toBeNull();
  expect(
    (await f.owner.query("SELECT to_regnamespace('route_pack_migrations') r")).rows[0].r,
  ).toBeNull();
  expect(await marker()).toBeNull();
});

test('a drifted guard definition stops the install and changes nothing', async () => {
  await migrateCustomerRealUse(f.owner);
  const original = await guard();
  expect(original.h).toBe(realUseHash);
  const drifted = original.d.replace(lastReturn, 'RETURN NEW; /* drift */');
  expect(drifted).not.toBe(original.d);
  await f.owner.query(drifted);
  try {
    await expect(migrateRoutePack(f.owner)).rejects.toThrow(
      'Route pack prerequisite function differs: app.guard_operations_control',
    );
    expect(await marker()).toBeNull();
    expect(
      (await f.owner.query("SELECT to_regnamespace('route_pack_migrations') r")).rows[0].r,
    ).toBeNull();
  } finally {
    await f.owner.query(original.d);
  }
  expect((await guard()).h).toBe(original.h);
});

test('install replaces exactly the operations guard, adds only the markers and the content guard, is repeatable and refuses a changed file', async () => {
  const before = await functionHashes();
  await migrateRoutePack(f.owner);
  await migrateRoutePack(f.owner);
  const after = await functionHashes();
  const changed = [...after]
    .filter(([name, hash]) => before.get(name) !== hash)
    .map(([name]) => name);
  expect(changed.sort()).toEqual([
    'app.guard_operations_control()',
    'app.guard_route_pack_content()',
    'app.route_pack_content_installed()',
    'app.route_pack_one_person_publication()',
  ]);
  expect([...before].filter(([name]) => !after.has(name))).toEqual([]);
  expect((await f.owner.query('SELECT app.route_pack_one_person_publication() n')).rows[0].n).toBe(
    true,
  );
  const applied = (await f.owner.query(`SELECT name,sha256 FROM ${registry} ORDER BY name`)).rows;
  expect(applied).toEqual([
    { name: file, sha256: sha(`${dir}/${file}`) },
    { name: contentFile, sha256: sha(`${dir}/${contentFile}`) },
  ]);
  await f.owner.query(`UPDATE ${registry} SET sha256=repeat('0',64)`);
  await expect(migrateRoutePack(f.owner)).rejects.toThrow('Route pack migration history mismatch');
  for (const row of applied)
    await f.owner.query(`UPDATE ${registry} SET sha256=$1 WHERE name=$2`, [row.sha256, row.name]);
  await migrateRoutePack(f.owner);
});

test('the marker needs no grant to be found, and the registry is reachable by nobody but the owner', async () => {
  for (const role of ['corridra_runtime', 'corridra_auth']) {
    expect(
      (
        await f.owner.query(
          `SELECT has_function_privilege('${role}','app.route_pack_one_person_publication()','EXECUTE') x,
                  has_schema_privilege('${role}','route_pack_migrations','USAGE') u`,
        )
      ).rows[0],
    ).toEqual({ x: false, u: false });
  }
});

test('the new definition differs from the real-use one by the two comparisons and the two messages only', async () => {
  const installed = (await guard()).d;
  const original = readFileSync(
    'packages/db/customer-real-use-migrations/0003_real_customer_modules.sql',
    'utf8',
  );
  const start = original.indexOf('CREATE OR REPLACE FUNCTION app.guard_operations_control()');
  const was = original.slice(
    start,
    original.indexOf('END $function$', start) + 'END $function$'.length,
  );
  expect(
    createHash('sha256')
      .update(was + '\n')
      .digest('hex'),
  ).toBe(realUseHash);
  expect(
    installed
      .replace(
        "OR r.valid_until<=now() OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=r.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) THEN RAISE EXCEPTION 'Current evidenced readiness required for every dimension'",
        "OR r.valid_until<=now() OR r.created_by=NEW.created_by OR NOT EXISTS(SELECT FROM app.source_record WHERE tenant_id=NEW.tenant_id AND id=r.source_id AND app.can_access(tenant_id,classification,purpose) AND retention_until>now()) THEN RAISE EXCEPTION 'Independent approval of current evidenced readiness required'",
      )
      .replace(
        "IF q.id IS NULL THEN RAISE EXCEPTION 'Configuration proposal required'",
        "IF q.id IS NULL OR q.created_by=NEW.created_by THEN RAISE EXCEPTION 'Independent configuration reviewer required'",
      ),
  ).toBe(was + '\n');
  // The publisher must still have written the published pack.
  expect(installed).toContain('p.created_by<>NEW.created_by');
});

// psql -f without --single-transaction sends one statement at a time and commits each. The extended protocol runs exactly
// one statement per call, so a file that passes through it is a single statement and is applied whole or not at all.
const oneStatement = (text: string) => ({ text, queryMode: 'extended' as const });
const rollbackFile = () =>
  readFileSync(`${dir}/rollback/0001_restore_independent_review.sql`, 'utf8');
// A checked-out client goes back to the pool only after ROLLBACK, so a failed assertion inside an open transaction cannot leave
// the migration lock, a registry change or a pg_proc change held for the next test. If ROLLBACK itself fails the client is destroyed.
const settle = (client: PoolClient) =>
  client.query('ROLLBACK').then(
    () => client.release(),
    (error: Error) => client.release(error),
  );
const state = async () => ({
  h: (await guard()).h,
  marker: await marker(),
  rows: (await f.owner.query(`SELECT name,sha256 FROM ${registry} ORDER BY name`)).rows,
});

test('the rollback refuses unless the guard is the ADR-093 definition, and then changes nothing', async () => {
  const installed = await guard();
  // The pin in the rollback is the hash of the definition the install leaves behind.
  expect(rollbackFile()).toContain(`<>'${installed.h}'`);
  const before = await state();
  const later = installed.d.replace(lastReturn, 'RETURN NEW; /* later */');
  expect(later).not.toBe(installed.d);
  await f.owner.query(later);
  try {
    await expect(f.owner.query(rollbackFile())).rejects.toThrow(
      'Route pack rollback refused: app.guard_operations_control is not the ADR-093 definition',
    );
    expect((await guard()).d).toBe(later);
    expect(await marker()).not.toBeNull();
    expect((await state()).rows).toEqual(before.rows);
  } finally {
    await f.owner.query(installed.d);
  }
  expect(await state()).toEqual(before);
});

test('the rollback refuses and changes nothing when the guard is the ADR-093 one but the module is not recorded', async () => {
  const before = await state();
  await f.owner.query(`DELETE FROM ${registry} WHERE name=$1`, [file]);
  try {
    for (const run of [rollbackFile(), oneStatement(rollbackFile())])
      await expect(f.owner.query(run)).rejects.toThrow(
        'Route pack rollback refused: the module is not recorded as installed',
      );
    expect((await guard()).h).toBe(before.h);
    expect(await marker()).not.toBeNull();
  } finally {
    await f.owner.query(`INSERT INTO ${registry}(name,sha256) VALUES($1,$2)`, [
      file,
      before.rows[0].sha256,
    ]);
  }
  expect(await state()).toEqual(before);
});

test('the rollback is one statement with no commit of its own, so a caller can still undo it', async () => {
  const before = await state();
  expect(before.marker).not.toBeNull();
  expect(before.rows).toHaveLength(2);
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(oneStatement(rollbackFile()));
    expect(
      (
        await db.query(
          "SELECT encode(sha256(convert_to(pg_get_functiondef('app.guard_operations_control()'::regprocedure),'UTF8')),'hex') h,to_regprocedure('app.route_pack_one_person_publication()') m",
        )
      ).rows[0],
    ).toEqual({ h: realUseHash, m: null });
    expect((await db.query(`SELECT name FROM ${registry}`)).rows).toEqual([{ name: contentFile }]);
    await db.query('ROLLBACK');
  } finally {
    await settle(db);
  }
  expect(await state()).toEqual(before);
});

test('the rollback waits for the migration lock the installer takes and changes nothing while it is held', async () => {
  const before = await state();
  const [holder, runner] = [await f.owner.connect(), await f.owner.connect()];
  try {
    await holder.query('BEGIN');
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await runner.query('BEGIN');
    await runner.query("SET LOCAL lock_timeout='300ms'");
    await expect(runner.query(rollbackFile())).rejects.toMatchObject({ code: '55P03' });
    await runner.query('ROLLBACK');
    await holder.query('ROLLBACK');
  } finally {
    await settle(runner);
    await settle(holder);
  }
  expect(await state()).toEqual(before);
});

test('the rollback as shipped restores the real-use definition, drops the marker and its registry row; a reinstall works', async () => {
  const installed = await guard();
  await f.owner.query(rollbackFile());
  expect((await guard()).h).toBe(realUseHash);
  expect(await marker()).toBeNull();
  // Only the 2b content module stays recorded.
  expect((await f.owner.query(`SELECT name FROM ${registry}`)).rows).toEqual([
    { name: contentFile },
  ]);
  // A second rollback finds the real-use definition and refuses.
  await expect(f.owner.query(rollbackFile())).rejects.toThrow('Route pack rollback refused');
  // Installing again after a rollback applies the module again, with nothing removed by hand.
  await migrateRoutePack(f.owner);
  expect((await guard()).h).toBe(installed.h);
  expect(await marker()).not.toBeNull();
  expect((await f.owner.query(`SELECT name,sha256 FROM ${registry} ORDER BY name`)).rows).toEqual([
    { name: file, sha256: sha(`${dir}/${file}`) },
    { name: contentFile, sha256: sha(`${dir}/${contentFile}`) },
  ]);
});
