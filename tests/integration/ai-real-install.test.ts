import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { configureAiRealRuns } from '../../packages/auth/src/ai-real-configuration';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { migrateAiModelPolicyReal } from '../../packages/db/src/ai-model-policy-real-migrate';
import { migrateAiRealRuns } from '../../packages/db/src/ai-real-runs-migrate';

// ADR-091, the database side of the install. The second step of the family replaces exactly three functions after hash
// checks, adds one control that starts closed and one function that reads it, and its rollback puts all three back.
let f: Awaited<ReturnType<typeof commercialFixture>>;
const registry = 'ai_model_policy_real_migrations.applied';
const dir = 'packages/db/ai-model-policy-real-migrations';
const first = '0001_real_workspace_model_policy.sql';
const second = '0002_real_workspace_runs.sql';
const rollbackFile = () =>
  readFileSync(`${dir}/rollback/0002_restore_sample_only_runs.sql`, 'utf8');
const firstRollback = () => readFileSync(`${dir}/rollback/0001_restore_guard_ai.sql`, 'utf8');
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const replaced = [
  'app.guard_ai()',
  'app.part4_enabled(uuid,text)',
  'app.ai_output_grounded(uuid,uuid,jsonb)',
] as const;
const marker = 'app.ai_real_runs_open()';
async function definition(name: string) {
  return (
    await f.owner.query(
      'SELECT pg_get_functiondef($1::regprocedure) d,encode(sha256(convert_to(pg_get_functiondef($1::regprocedure),$2)),$3) h',
      [name, 'UTF8', 'hex'],
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
const present = async (name: string) =>
  (await f.owner.query('SELECT to_regprocedure($1) r', [name])).rows[0].r !== null;
const applied = async () =>
  (await f.owner.query(`SELECT name,sha256 FROM ${registry} ORDER BY name`)).rows;
const state = async () => ({
  hashes: Object.fromEntries(
    await Promise.all(replaced.map(async (name) => [name, (await definition(name)).h])),
  ),
  marker: await present(marker),
  rows: await applied(),
});
// The body of a function as PostgreSQL stores it, and as a migration file writes it.
const stored = (text: string) => {
  const start = text.indexOf('$function$') + '$function$'.length;
  return text.slice(start, text.lastIndexOf('$function$'));
};
const written = (file: string, open: string) => {
  const text = readFileSync(file, 'utf8');
  const head = text.indexOf(open);
  const start = text.indexOf('AS $$', head) + 'AS $$'.length;
  return text.slice(start, text.indexOf('$$;', start));
};
const drift = (d: string) => {
  const cut = d.lastIndexOf('$function$');
  return d.slice(0, cut).replace(/\s*$/, ' /* drift */\n') + d.slice(cut);
};
// The extended protocol runs exactly one statement per call, so a file that passes through it is a single statement.
const oneStatement = (text: string) => ({ text, queryMode: 'extended' as const });
let prior: Awaited<ReturnType<typeof state>>;

beforeAll(async () => {
  f = await commercialFixture();
  await migrateCustomerRealUse(f.owner);
}, 300000);
afterAll(async () => {
  await f?.close();
});

test('the step will not install without the real Network module and records nothing', async () => {
  await expect(migrateAiRealRuns(f.owner)).rejects.toThrow(
    'The network real-use module is not installed',
  );
  expect((await f.owner.query(`SELECT to_regclass('${registry}') r`)).rows[0].r).toBeNull();
  expect(await present(marker)).toBe(false);
  await expect(
    configureAiRealRuns(f.owner, { enabled: true, reason: 'Owner opened AI for real workspaces' }),
  ).rejects.toThrow('AI for real workspaces is not installed');
});

test('the ADR-089 action installs its own step only, never this one', async () => {
  await migrateNetworkRealUse(f.owner);
  await migrateAiModelPolicyReal(f.owner);
  await migrateAiModelPolicyReal(f.owner);
  expect(await applied()).toEqual([{ name: first, sha256: sha(`${dir}/${first}`) }]);
  expect(await present(marker)).toBe(false);
  expect((await f.owner.query("SELECT to_regclass('app.ai_real_control') r")).rows[0].r).toBeNull();
  prior = await state();
});

test('a drifted definition of any of the three functions stops the install and changes nothing', async () => {
  for (const name of replaced) {
    const original = await definition(name);
    const drifted = drift(original.d);
    expect(drifted).not.toBe(original.d);
    await f.owner.query(drifted);
    try {
      await expect(migrateAiRealRuns(f.owner), name).rejects.toThrow(
        'AI real workspace prerequisite differs',
      );
      expect(await present(marker)).toBe(false);
      expect(await applied()).toEqual(prior.rows);
    } finally {
      await f.owner.query(original.d);
    }
    expect((await definition(name)).h).toBe(original.h);
  }
  expect(await state()).toEqual(prior);
});

test('install replaces exactly the three functions, adds the closed control, is repeatable and refuses a tampered history', async () => {
  const before = await functionHashes();
  await migrateAiRealRuns(f.owner);
  await migrateAiRealRuns(f.owner);
  // The ADR-089 action stays a no-op afterwards.
  await migrateAiModelPolicyReal(f.owner);
  const after = await functionHashes();
  const changed = [...after]
    .filter(([name, hash]) => before.get(name) !== hash)
    .map(([name]) => name);
  expect(changed.sort()).toEqual([...replaced, marker].sort());
  expect([...before].filter(([name]) => !after.has(name))).toEqual([]);
  expect(await applied()).toEqual([
    { name: first, sha256: sha(`${dir}/${first}`) },
    { name: second, sha256: sha(`${dir}/${second}`) },
  ]);
  expect((await f.owner.query('SELECT app.ai_real_runs_open() open')).rows[0].open).toBe(false);
  expect((await f.owner.query('SELECT count(*)::int n FROM app.ai_real_control')).rows[0].n).toBe(
    0,
  );
  await f.owner.query(`UPDATE ${registry} SET sha256=repeat('0',64) WHERE name=$1`, [second]);
  await expect(migrateAiRealRuns(f.owner)).rejects.toThrow('history mismatch');
  await f.owner.query(`UPDATE ${registry} SET sha256=$1 WHERE name=$2`, [
    sha(`${dir}/${second}`),
    second,
  ]);
  await migrateAiRealRuns(f.owner);
});

test('the control answers the runtime role only, and nobody but the owner reads or writes its table', async () => {
  expect(
    (
      await f.owner.query(
        `SELECT has_function_privilege('corridra_runtime','${marker}','EXECUTE') r,
                has_function_privilege('corridra_auth','${marker}','EXECUTE') a,
                has_function_privilege('public','${marker}','EXECUTE') p`,
      )
    ).rows[0],
  ).toEqual({ r: true, a: false, p: false });
  for (const role of ['corridra_runtime', 'corridra_auth'])
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      expect(
        (
          await f.owner.query('SELECT has_table_privilege($1,$2,$3) ok', [
            role,
            'app.ai_real_control',
            privilege,
          ])
        ).rows[0].ok,
        `${role} ${privilege}`,
      ).toBe(false);
  expect(
    (
      await f.owner.query(
        "SELECT relrowsecurity r FROM pg_class WHERE oid='app.ai_real_control'::regclass",
      )
    ).rows[0].r,
  ).toBe(true);
  // The grants of the three replaced functions are as before: replacing a function keeps them.
  expect(
    (
      await f.owner.query(
        `SELECT has_function_privilege('corridra_runtime','app.part4_enabled(uuid,text)','EXECUTE') part4,
                has_function_privilege('corridra_runtime','app.ai_output_grounded(uuid,uuid,jsonb)','EXECUTE') grounded,
                has_function_privilege('public','app.guard_ai()','EXECUTE') guard_public`,
      )
    ).rows[0],
  ).toEqual({ part4: true, grounded: true, guard_public: false });
});

test('only the named lines differ from the definitions the step found', async () => {
  // 1. app.guard_ai(): the opening check of the five run tables and one added check; everything else is byte-identical.
  const guardWas = written(`${dir}/${first}`, 'FUNCTION app.guard_ai()');
  const opening =
    " ELSIF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL','synthetic_validation') OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND synthetic) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;\n";
  const openingNow =
    " ELSIF NEW.created_by<>app.actor_id() OR NOT app.can_access(NEW.tenant_id,'INTERNAL',app.tenant_processing_purpose(NEW.tenant_id)) OR NOT EXISTS(SELECT FROM app.tenant WHERE id=NEW.tenant_id AND (synthetic OR (app.real_use_allowed(id) AND app.ai_real_runs_open()))) THEN RAISE EXCEPTION 'Scoped synthetic actor required' USING ERRCODE='42501'; END IF;\n" +
    " IF TG_TABLE_NAME IN ('ai_run','ai_attempt') THEN\n  IF NOT coalesce(app.tenant_is_synthetic(NEW.tenant_id),false) AND NOT EXISTS(SELECT FROM app.ai_model_policy WHERE tenant_id=NEW.tenant_id AND id=NEW.policy_id AND configuration->>'evaluationStatus'='APPROVED_PROVIDER') THEN RAISE EXCEPTION 'Approved provider evaluation required in a real workspace' USING ERRCODE='42501'; END IF;\n END IF;\n";
  const guardNow = stored((await definition('app.guard_ai()')).d);
  expect(guardWas.split(opening)).toHaveLength(2);
  expect(guardNow.split(openingNow)).toHaveLength(2);
  expect(guardNow.replace(openingNow, opening).trim()).toBe(guardWas.trim());
  // 2. app.part4_enabled: one more way for the key ai.enabled to be true in a real workspace, behind the control.
  const part4Was = written(
    'packages/db/network-real-use-migrations/0001_real_invited_execution.sql',
    'CREATE OR REPLACE FUNCTION app.part4_enabled(t uuid,k text)',
  );
  const part4Now = stored((await definition('app.part4_enabled(uuid,text)')).d);
  const key = " AND (app.tenant_is_synthetic(t) OR k='network.enabled')\n";
  const keyNow =
    " AND (app.tenant_is_synthetic(t) OR k='network.enabled' OR (k='ai.enabled' AND app.ai_real_runs_open()))\n";
  expect(part4Now.split(keyNow)).toHaveLength(2);
  expect(part4Now.replace(keyNow, key).trim()).toBe(part4Was.trim());
  // 3. app.ai_output_grounded: the access check reads the workspace's own purpose; every grounding rule is byte-identical.
  const groundedWas = written(
    'packages/db/migrations/0026_governed_intelligence.sql',
    'CREATE FUNCTION app.ai_output_grounded(t uuid,rid uuid,o jsonb)',
  );
  const groundedNow = stored((await definition('app.ai_output_grounded(uuid,uuid,jsonb)')).d);
  const access = "IF NOT app.can_access(t,'INTERNAL','synthetic_validation') OR";
  const accessNow = "IF NOT app.can_access(t,'INTERNAL',app.tenant_processing_purpose(t)) OR";
  expect(groundedNow.split(accessNow)).toHaveLength(2);
  expect(groundedNow.replace(accessNow, access).trim()).toBe(groundedWas.trim());
});

test('the rollback pins the installed definitions and refuses, changing nothing, on drift or while the control is open', async () => {
  const installed = await state();
  const rollback = rollbackFile();
  for (const name of replaced) expect(rollback).toContain(`<>'${installed.hashes[name]}'`);
  // The ADR-089 rollback cannot run over this step.
  await expect(f.owner.query(firstRollback())).rejects.toThrow(
    'AI model policy rollback refused: app.guard_ai is not the ADR-089 definition',
  );
  for (const name of replaced) {
    const original = await definition(name);
    await f.owner.query(drift(original.d));
    try {
      await expect(f.owner.query(rollback), name).rejects.toThrow(
        'AI real workspace rollback refused: a function is not the ADR-091 definition',
      );
    } finally {
      await f.owner.query(original.d);
    }
  }
  await configureAiRealRuns(f.owner, {
    enabled: true,
    reason: 'Owner opened AI for real workspaces',
  });
  await expect(f.owner.query(rollback)).rejects.toThrow(
    'AI real workspace rollback refused: pause AI for real workspaces first',
  );
  expect(await state()).toEqual(installed);
  await configureAiRealRuns(f.owner, {
    enabled: false,
    reason: 'Owner paused AI for real workspaces',
  });
  await f.owner.query(`DELETE FROM ${registry} WHERE name=$1`, [second]);
  try {
    await expect(f.owner.query(rollback)).rejects.toThrow(
      'AI real workspace rollback refused: the module is not recorded as installed',
    );
  } finally {
    await f.owner.query(`INSERT INTO ${registry}(name,sha256) VALUES($1,$2)`, [
      second,
      sha(`${dir}/${second}`),
    ]);
  }
  expect(await state()).toEqual(installed);
});

test('the rollback is one statement with no commit of its own, so a caller can still undo it', async () => {
  const before = await state();
  const db = await f.owner.connect();
  try {
    await db.query('BEGIN');
    await db.query(oneStatement(rollbackFile()));
    expect((await db.query('SELECT to_regprocedure($1) r', [marker])).rows[0].r).toBeNull();
    await db.query('ROLLBACK');
  } finally {
    await db.query('ROLLBACK').then(
      () => db.release(),
      (error: Error) => db.release(error),
    );
  }
  expect(await state()).toEqual(before);
});

test('the rollback as shipped restores the three earlier definitions and keeps the control record; a reinstall starts closed', async () => {
  const installed = await state();
  await f.owner.query(rollbackFile());
  expect(await state()).toEqual(prior);
  // The record of who opened and paused the control stays, and cannot be rewritten.
  expect(
    (await f.owner.query('SELECT version,enabled FROM app.ai_real_control ORDER BY version')).rows,
  ).toEqual([
    { version: 1, enabled: true },
    { version: 2, enabled: false },
  ]);
  await expect(f.owner.query('DELETE FROM app.ai_real_control')).rejects.toThrow();
  await expect(f.owner.query(rollbackFile())).rejects.toThrow('AI real workspace rollback refused');
  await expect(
    configureAiRealRuns(f.owner, { enabled: true, reason: 'Owner opened AI for real workspaces' }),
  ).rejects.toThrow('AI for real workspaces is not installed');
  await migrateAiRealRuns(f.owner);
  expect(await state()).toEqual(installed);
  expect((await f.owner.query('SELECT app.ai_real_runs_open() open')).rows[0].open).toBe(false);
  // With this step rolled back again, the ADR-089 rollback runs as before.
  await f.owner.query(rollbackFile());
  await f.owner.query(firstRollback());
  expect((await definition('app.guard_ai()')).h).toBe(
    '6b4f74d16b5cbdc81a25b3aba81d296bac77c888be5aec3af891015762ce8e1b',
  );
  expect(await applied()).toEqual([]);
  // One install of this step brings both back.
  await migrateAiRealRuns(f.owner);
  expect(await state()).toEqual(installed);
});
