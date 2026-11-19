import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateAiModelPolicyReal } from '../../packages/db/src/ai-model-policy-real-migrate';

// ADR-089, the database side of the install. app.guard_ai() is replaced once, hash-guarded, by an optional module. The only
// differences from the 0026 definition are the opening check for app.ai_model_policy and the location bound.
let f: Awaited<ReturnType<typeof commercialFixture>>;
const registry = 'ai_model_policy_real_migrations.applied';
const file = '0001_real_workspace_model_policy.sql';
const dir = 'packages/db/ai-model-policy-real-migrations';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
async function guard() {
  return (
    await f.owner.query(
      "SELECT pg_get_functiondef('app.guard_ai()'::regprocedure) d,encode(sha256(convert_to(pg_get_functiondef('app.guard_ai()'::regprocedure),'UTF8')),'hex') h",
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
  (await f.owner.query("SELECT to_regprocedure('app.ai_model_policy_location_limit()') r")).rows[0]
    .r;
beforeAll(async () => {
  f = await commercialFixture();
}, 120000);
afterAll(async () => {
  await f?.close();
});

test('the module will not install without the real-use modules and records nothing', async () => {
  await expect(migrateAiModelPolicyReal(f.owner)).rejects.toThrow(
    'customer real-use modules are not installed',
  );
  expect(
    (await f.owner.query("SELECT to_regclass('ai_model_policy_real_migrations.applied') r")).rows[0]
      .r,
  ).toBeNull();
  expect(await marker()).toBeNull();
});

test('a drifted guard_ai definition stops the install and changes nothing', async () => {
  await migrateCustomerRealUse(f.owner);
  const original = await guard();
  const drifted = original.d.replace(
    /RETURN NEW;(?![\s\S]*RETURN NEW;)/,
    'RETURN NEW; /* drift */',
  );
  expect(drifted).not.toBe(original.d);
  await f.owner.query(drifted);
  try {
    await expect(migrateAiModelPolicyReal(f.owner)).rejects.toThrow(
      'AI model policy prerequisite function differs: app.guard_ai',
    );
    expect(await marker()).toBeNull();
  } finally {
    await f.owner.query(original.d);
  }
  expect((await guard()).h).toBe(original.h);
});

test('install replaces exactly guard_ai, adds the marker, is repeatable and refuses a tampered history', async () => {
  const before = await functionHashes();
  await migrateAiModelPolicyReal(f.owner);
  await migrateAiModelPolicyReal(f.owner);
  const after = await functionHashes();
  const changed = [...after]
    .filter(([name, hash]) => before.get(name) !== hash)
    .map(([name]) => name);
  expect(changed.sort()).toEqual(['app.ai_model_policy_location_limit()', 'app.guard_ai()']);
  expect([...before].filter(([name]) => !after.has(name))).toEqual([]);
  expect((await f.owner.query('SELECT app.ai_model_policy_location_limit() n')).rows[0].n).toBe(30);
  const applied = (await f.owner.query(`SELECT name,sha256 FROM ${registry}`)).rows;
  expect(applied).toEqual([{ name: file, sha256: sha(`${dir}/${file}`) }]);
  await f.owner.query(`UPDATE ${registry} SET sha256=repeat('0',64)`);
  await expect(migrateAiModelPolicyReal(f.owner)).rejects.toThrow('history mismatch');
  await f.owner.query(`UPDATE ${registry} SET sha256=$1`, [applied[0].sha256]);
  await migrateAiModelPolicyReal(f.owner);
});

test('the marker is reachable by the runtime role only, and the registry by nobody but the owner', async () => {
  expect(
    (
      await f.owner.query(
        `SELECT has_function_privilege('corridra_runtime','app.ai_model_policy_location_limit()','EXECUTE') r,
                has_function_privilege('corridra_auth','app.ai_model_policy_location_limit()','EXECUTE') a`,
      )
    ).rows[0],
  ).toEqual({ r: true, a: false });
  for (const role of ['corridra_runtime', 'corridra_auth'])
    expect(
      (
        await f.owner.query(
          `SELECT has_schema_privilege('${role}','ai_model_policy_real_migrations','USAGE') u`,
        )
      ).rows[0].u,
    ).toBe(false);
});

test('only the policy opening check and its bound differ from the 0026 definition', async () => {
  const installed = (await guard()).d;
  const original = readFileSync('packages/db/migrations/0026_governed_intelligence.sql', 'utf8');
  const body = (text: string, open: string, close: string) => {
    const start = text.indexOf(open, text.indexOf('app.guard_ai()')) + open.length;
    return text.slice(start, text.indexOf(close, start));
  };
  const trim = (text: string) => text.replace(/\s*END\s*\$?\s*$/, '');
  const now = trim(body(installed, '$function$', '$function$'));
  const was = trim(body(original, 'AS $$', '$$;\nDO $$ DECLARE t text'));
  const opening =
    " IF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;\n";
  const policyOpening =
    " IF TG_TABLE_NAME='ai_model_policy' THEN\n  IF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR app.real_use_allowed(id))) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;\n ELSIF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;\n";
  expect(was).toContain(opening);
  expect(now).toContain(policyOpening);
  expect(
    now.replace(policyOpening, opening).replace('NOT BETWEEN 1 AND 30', 'NOT BETWEEN 1 AND 20'),
  ).toBe(was);
});

test('the rollback refuses unless guard_ai is the ADR-089 definition, and then changes nothing', async () => {
  const installed = await guard();
  const rollback = readFileSync(`${dir}/rollback/0001_restore_guard_ai.sql`, 'utf8');
  // The pin in the rollback is the hash of the definition the install leaves behind.
  expect(rollback).toContain(`<>'${installed.h}'`);
  const rows = async () => (await f.owner.query(`SELECT name,sha256 FROM ${registry}`)).rows;
  const recorded = await rows();
  const later = installed.d.replace(/RETURN NEW;(?![\s\S]*RETURN NEW;)/, 'RETURN NEW; /* later */');
  expect(later).not.toBe(installed.d);
  await f.owner.query(later);
  try {
    await expect(f.owner.query(rollback)).rejects.toThrow(
      'AI model policy rollback refused: app.guard_ai is not the ADR-089 definition',
    );
    expect((await guard()).d).toBe(later);
    expect(await marker()).not.toBeNull();
    expect(await rows()).toEqual(recorded);
  } finally {
    await f.owner.query(installed.d);
  }
  expect((await guard()).h).toBe(installed.h);
});

// psql -f without --single-transaction sends one statement at a time and commits each. The extended protocol runs exactly
// one statement per call, so a file that passes through it is a single statement and is applied whole or not at all.
const oneStatement = (text: string) => ({ text, queryMode: 'extended' as const });
const rollbackFile = () => readFileSync(`${dir}/rollback/0001_restore_guard_ai.sql`, 'utf8');
const state = async () => ({
  h: (await guard()).h,
  marker: await marker(),
  rows: (await f.owner.query(`SELECT name,sha256 FROM ${registry} ORDER BY name`)).rows,
});

test('the rollback is one statement with no commit of its own, so a caller can still undo it', async () => {
  const before = await state();
  expect(before.marker).not.toBeNull();
  expect(before.rows).toHaveLength(1);
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(oneStatement(rollbackFile()));
    expect(
      (
        await db.query(
          "SELECT encode(sha256(convert_to(pg_get_functiondef('app.guard_ai()'::regprocedure),'UTF8')),'hex') h",
        )
      ).rows[0].h,
    ).toBe('6b4f74d16b5cbdc81a25b3aba81d296bac77c888be5aec3af891015762ce8e1b');
    expect((await db.query(`SELECT name FROM ${registry}`)).rows).toEqual([]);
    await db.query('ROLLBACK');
  } finally {
    db.release();
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
    await expect(runner.query(rollbackFile())).rejects.toMatchObject({
      code: '55P03',
    });
    await runner.query('ROLLBACK');
    await holder.query('ROLLBACK');
  } finally {
    holder.release();
    runner.release();
  }
  expect(await state()).toEqual(before);
});

test('the rollback refuses and changes nothing when guard_ai is the ADR-089 one but the registry row is missing', async () => {
  const before = await state();
  await f.owner.query(`DELETE FROM ${registry} WHERE name=$1`, [file]);
  try {
    for (const run of [rollbackFile(), oneStatement(rollbackFile())])
      await expect(f.owner.query(run)).rejects.toThrow(
        'AI model policy rollback refused: the module is not recorded as installed',
      );
    expect((await guard()).h).toBe(before.h);
    expect(await marker()).not.toBeNull();
  } finally {
    await f.owner.query(`INSERT INTO ${registry}(name,sha256) VALUES($1,$2)`, [
      file,
      before.rows[0].sha256,
    ]);
  }
  expect((await state()).rows).toEqual(before.rows);
});

test('a rollback that fails after its registry delete, run one statement at a time, keeps the registry row', async () => {
  const before = await state();
  // A view on the marker makes the final DROP FUNCTION fail, after the DELETE and the guard restore have run.
  await f.owner.query(
    'CREATE VIEW app.ai_rollback_probe AS SELECT app.ai_model_policy_location_limit() n',
  );
  try {
    await expect(f.owner.query(oneStatement(rollbackFile()))).rejects.toMatchObject({
      code: '2BP01',
    });
    expect(await state()).toEqual(before);
  } finally {
    await f.owner.query('DROP VIEW app.ai_rollback_probe');
  }
});

test('the rollback as shipped restores the 0026 definition, drops the marker and its registry row; a reinstall works', async () => {
  const installed = await guard();
  const rollback = readFileSync(`${dir}/rollback/0001_restore_guard_ai.sql`, 'utf8');
  await f.owner.query(rollback);
  expect((await guard()).h).toBe(
    '6b4f74d16b5cbdc81a25b3aba81d296bac77c888be5aec3af891015762ce8e1b',
  );
  expect(await marker()).toBeNull();
  expect((await f.owner.query(`SELECT name FROM ${registry}`)).rows).toEqual([]);
  // A second rollback finds the 0026 definition and refuses.
  await expect(f.owner.query(rollback)).rejects.toThrow('AI model policy rollback refused');
  // Installing again after a rollback applies the module again, with nothing removed by hand.
  await migrateAiModelPolicyReal(f.owner);
  expect((await guard()).h).toBe(installed.h);
  expect(await marker()).not.toBeNull();
  expect((await f.owner.query('SELECT app.ai_model_policy_location_limit() n')).rows[0].n).toBe(30);
  expect((await f.owner.query(`SELECT name,sha256 FROM ${registry}`)).rows).toEqual([
    { name: file, sha256: sha(`${dir}/${file}`) },
  ]);
});
