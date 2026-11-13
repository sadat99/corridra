import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixture } from './support';
import { refused } from './supply-support';
import { migrateSupplySources } from '../../packages/db/src/supply-source-migrate';
import { migrateCustomerRealUse } from '../../packages/db/src/customer-real-use-migrate';
import { migrateNetworkRealUse } from '../../packages/db/src/network-real-use-migrate';
import { configureSupplySources } from '../../packages/auth/src/supply-source-configuration';
import { SupplyProfileService } from '../../packages/counterparties/src/supply-profiles';
import { SupplyCandidateService } from '../../packages/counterparties/src/supply-candidates';
import { profileWords } from '../../packages/domain/src/counterparty-profiles';

// ADR-082 section 12 and slice S2: the module installs only when its prerequisites are there, installs with its control
// closed, is repeatable, refuses a changed history, replaces no existing function or trigger, and with the module absent
// the application answers that supply sources are not available (never a server error).
const file = '0001_counterparty_profiles.sql';
const second = '0002_supply_sources_and_candidates.sql';
const moduleTables = [
  'supply_command',
  'counterparty_profile_version',
  'supply_source_control',
  'supply_source',
  'supply_source_version',
  'supply_import_batch',
  'supply_candidate',
  'supply_candidate_review',
  'supply_candidate_match',
  'supply_do_not_contact',
];
// The four additive S3 triggers on core communication tables, and nothing else new on a watched table.
const addedTriggers = [
  'communication_supply_dnc',
  'communication_dispatch_supply_dnc',
  'communication_dispatch_retry_supply_dnc',
  'communication_receipt_supply_dnc',
];
const read = async (name: string) =>
  readFile(new URL(`../../packages/db/supply-source-migrations/${name}`, import.meta.url), 'utf8');
const existingFunctions = [
  'app.reject_rewrite()',
  'app.record_change()',
  'app.actor_id()',
  'app.can_access(uuid,text,text)',
  'app.member_role(uuid)',
  'app.fresh_mfa()',
  'app.guard_research_record()',
  'app.guard_communication()',
  'app.communication_allowed(uuid,boolean)',
  'app.real_use_allowed(uuid)',
  'app.tenant_processing_purpose(uuid)',
  'app.tenant_is_synthetic(uuid)',
  'app.queue_communication(uuid,text)',
  'app.claim_communication(uuid,text,uuid)',
  'app.buyer_view(text)',
];
const watchedTables = [
  'mission',
  'target_profile',
  'domain_event',
  'communication',
  'communication_dispatch',
  'communication_receipt',
  'organisation',
];
let f: Awaited<ReturnType<typeof fixture>>;
const definitions = async () =>
  (
    await f.owner.query(
      `SELECT p::text AS name,encode(sha256(convert_to(pg_get_functiondef(to_regprocedure(p)),'UTF8')),'hex') AS hash FROM unnest($1::text[]) AS p ORDER BY 1`,
      [existingFunctions],
    )
  ).rows;
const triggers = async (withAdded = false) =>
  (
    await f.owner.query(
      `SELECT c.relname,t.tgname,t.tgfoid::regprocedure::text AS fn FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='app' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal AND ($2 OR t.tgname<>ALL($3::text[])) ORDER BY 1,2`,
      [watchedTables, withAdded, addedTriggers],
    )
  ).rows;
const policies = async () =>
  (
    await f.owner.query(
      `SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='app' AND tablename<>ALL($1::text[]) ORDER BY 1,2`,
      [moduleTables],
    )
  ).rows;
const registry = async () =>
  (
    await f.owner.query(
      'SELECT name,sha256,applied_at FROM supply_source_migrations.applied ORDER BY name',
    )
  ).rows;
const present = async () =>
  (await f.owner.query("SELECT to_regclass('app.counterparty_profile_version') IS NOT NULL AS p"))
    .rows[0].p as boolean;
let before: Awaited<ReturnType<typeof snapshot>>;
const snapshot = async () => ({
  definitions: await definitions(),
  triggers: await triggers(),
  policies: await policies(),
  core: (await f.owner.query('SELECT name,sha256 FROM migrations.applied ORDER BY name')).rows,
});
beforeAll(async () => {
  f = await fixture();
});
afterAll(async () => {
  await f?.close();
});

describe('before the module is installed', () => {
  test('the install refuses, saying exactly which step to run, and creates nothing', async () => {
    expect(await refused(migrateSupplySources(f.owner))).toBe(
      'Install the real-use modules first (real_use_action=install).',
    );
    await migrateCustomerRealUse(f.owner);
    expect(await refused(migrateSupplySources(f.owner))).toBe(
      'Install the network real-use module first (network_use_action=install).',
    );
    expect(await present()).toBe(false);
    expect(
      (await f.owner.query("SELECT to_regnamespace('supply_source_migrations') IS NOT NULL AS p"))
        .rows[0].p,
    ).toBe(false);
  });

  test('the configure step refuses until installed, and the service answers not available with code and no server error', async () => {
    await migrateNetworkRealUse(f.owner);
    expect(
      await refused(
        configureSupplySources(f.owner, { enabled: true, reason: 'Open before install' }),
      ),
    ).toBe('Supply sources are not installed. Run the explicit supply_sources_install first.');
    const service = new SupplyProfileService(f.runtime);
    const input = { missionId: randomUUID(), role: 'BUYER' };
    const saved = service.save(f.users.operator.ctx, {
      ...input,
      commandId: randomUUID(),
      expectedVersion: 0,
      reason: 'Before the module exists',
      fields: {
        productCategory: { key: 'home_textiles', words: 'Cotton hotel towels' },
        counterpartyTypes: ['importer'],
        candidatesWanted: 5,
        deadline: '2026-12-15',
      },
    });
    await expect(saved).rejects.toMatchObject({
      status: 409,
      code: 'SUPPLY_UNAVAILABLE',
      message: profileWords.notInstalled,
    });
    await expect(service.latest(f.users.viewer.ctx, input)).rejects.toMatchObject({
      status: 409,
      code: 'SUPPLY_UNAVAILABLE',
    });
  });
});

describe('installing', () => {
  test('installs with the control closed and the registry showing the file and its hash', async () => {
    // Taken after the real-use and network modules (which change some of these functions) and before this module.
    before = await snapshot();
    await migrateSupplySources(f.owner);
    expect(await present()).toBe(true);
    const rows = await registry();
    expect(rows.map((r) => r.name)).toEqual([file, second]);
    for (const row of rows)
      expect(row.sha256).toBe(
        createHash('sha256')
          .update(await read(row.name))
          .digest('hex'),
      );
    expect(
      (await f.owner.query('SELECT count(*)::int n FROM app.supply_source_control')).rows[0].n,
    ).toBe(0);
    expect((await f.owner.query('SELECT app.supply_module_enabled() AS open')).rows[0].open).toBe(
      false,
    );
    for (const control of [
      'module',
      'partner_kinds',
      'platform_kind',
      'connectors',
      'mode_b_release',
      'personal_data',
      'staff_file_import',
    ])
      expect(
        (await f.owner.query('SELECT app.supply_control_open($1) AS open', [control])).rows[0].open,
        control,
      ).toBe(false);
  });

  test('a repeat install changes nothing: same registry row, no new rows, no error', async () => {
    const first = await registry();
    await migrateSupplySources(f.owner);
    await migrateSupplySources(f.owner);
    expect(await registry()).toEqual(first);
  });

  test('it replaces no existing function, trigger or policy, and no core migration changes; the only new triggers are the four do-not-contact ones', async () => {
    expect(await definitions()).toEqual(before.definitions);
    expect(await triggers()).toEqual(before.triggers);
    expect(
      (await triggers(true))
        .filter((t) => addedTriggers.includes(t.tgname))
        .map((t) => [t.relname, t.tgname, t.fn]),
    ).toEqual([
      ['communication', 'communication_supply_dnc', 'app.supply_contact_guard()'],
      [
        'communication_dispatch',
        'communication_dispatch_retry_supply_dnc',
        'app.supply_contact_guard()',
      ],
      ['communication_dispatch', 'communication_dispatch_supply_dnc', 'app.supply_contact_guard()'],
      ['communication_receipt', 'communication_receipt_supply_dnc', 'app.supply_contact_guard()'],
    ]);
    expect(await policies()).toEqual(before.policies);
    expect(
      (await f.owner.query('SELECT name,sha256 FROM migrations.applied ORDER BY name')).rows,
    ).toEqual(before.core);
  });

  test('a changed history is refused and nothing else is applied', async () => {
    for (const name of [file, second]) {
      await f.owner.query('UPDATE supply_source_migrations.applied SET sha256=$1 WHERE name=$2', [
        'a'.repeat(64),
        name,
      ]);
      expect(await refused(migrateSupplySources(f.owner))).toBe(
        'Supply source migration history mismatch',
      );
      await f.owner.query('UPDATE supply_source_migrations.applied SET sha256=$1 WHERE name=$2', [
        createHash('sha256')
          .update(await read(name))
          .digest('hex'),
        name,
      ]);
      await migrateSupplySources(f.owner);
    }
    await f.owner.query('INSERT INTO supply_source_migrations.applied(name,sha256) VALUES($1,$2)', [
      '9999_unknown_file.sql',
      'b'.repeat(64),
    ]);
    expect(await refused(migrateSupplySources(f.owner))).toBe(
      'Supply source migration history mismatch',
    );
    await f.owner.query(
      "DELETE FROM supply_source_migrations.applied WHERE name='9999_unknown_file.sql'",
    );
    await migrateSupplySources(f.owner);
  });

  test('the registry schema is closed to the application logins', async () => {
    for (const pool of [f.runtime, f.auth])
      expect(await refused(pool.query('SELECT * FROM supply_source_migrations.applied'))).toMatch(
        /permission denied/i,
      );
  });
});

// A database that has only the first file (every earlier S2 install), with real rows in it, takes the second file without
// changing a row, a function or a trigger of the first; and until the second file is there the candidate service answers
// "not available" with its code, never a server error.
describe('upgrading a populated first-file install', () => {
  let populated: Awaited<ReturnType<typeof fixture>>;
  const snapshot = async () =>
    (
      await populated.owner.query(
        `SELECT jsonb_build_object(
        'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM app.counterparty_profile_version p),
        'commands',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM app.supply_command c),
        'controls',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY control,version),'[]') FROM app.supply_source_control c),
        'events',(SELECT count(*) FROM app.domain_event),
        'saveFunction',encode(sha256(convert_to(pg_get_functiondef('app.save_counterparty_profile(uuid,uuid,text,uuid,text,integer,jsonb,text,uuid)'::regprocedure),'UTF8')),'hex'),
        'triggers',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.relname,t.tgname,t.tgfoid::regprocedure::text) ORDER BY c.relname,t.tgname),'[]')
          FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='app' AND NOT t.tgisinternal AND t.tgname<>ALL($1::text[]) AND c.relname<>ALL($2::text[])),
        'policies',(SELECT coalesce(jsonb_agg(jsonb_build_array(tablename,policyname,qual,with_check) ORDER BY tablename,policyname),'[]')
          FROM pg_policies WHERE schemaname='app' AND tablename<>ALL($2::text[]))) AS data`,
        [addedTriggers, moduleTables.slice(3)],
      )
    ).rows[0].data;

  test('the first file alone: the service answers not available with its code; then populated rows survive the second file', async () => {
    await f.close();
    populated = await fixture();
    f = populated;
    await migrateNetworkRealUse(populated.owner);
    const client = await populated.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE SCHEMA supply_source_migrations');
      await client.query(
        'REVOKE ALL ON SCHEMA supply_source_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
      );
      await client.query(
        'CREATE TABLE supply_source_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
      );
      const sql = await read(file);
      await client.query(sql);
      await client.query(
        'INSERT INTO supply_source_migrations.applied(name,sha256) VALUES($1,$2)',
        [file, createHash('sha256').update(sql).digest('hex')],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const candidates = new SupplyCandidateService(populated.runtime);
    await expect(
      candidates.createSource(populated.users.operator.ctx, {
        commandId: randomUUID(),
        kind: 'staff_research',
        status: 'active',
        label: 'Before the second file',
        defaultRetentionMonths: 6,
        reason: 'The second file is not installed',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'SUPPLY_UNAVAILABLE',
      message: profileWords.notInstalled,
    });
    await expect(candidates.listSources(populated.users.viewer.ctx)).rejects.toMatchObject({
      status: 409,
      code: 'SUPPLY_UNAVAILABLE',
    });
    // Populate the first file: open the module, save a profile for a mission.
    await populated.owner.query(
      "INSERT INTO app.supply_source_control(control,version,enabled,reason) VALUES('module',1,true,'Open the module for the upgrade test')",
    );
    const mission = randomUUID();
    const db = await populated.owner.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
        [populated.serviceId, randomUUID(), randomUUID()],
      );
      await db.query(
        "INSERT INTO app.mission(id,tenant_id,owner_id,next_action,due_at,reason,created_by) VALUES($1,$2,$3,'Find counterparties',now()+interval '1 day','Synthetic supply mission',$3)",
        [mission, populated.tenantA, populated.users.operator.id],
      );
      await db.query('COMMIT');
    } finally {
      db.release();
    }
    const saved = await new SupplyProfileService(populated.runtime).save(
      populated.users.operator.ctx,
      {
        commandId: randomUUID(),
        missionId: mission,
        role: 'BUYER',
        expectedVersion: 0,
        reason: 'Profile before the second file',
        fields: {
          productCategory: { key: 'home_textiles', words: 'Cotton hotel towels' },
          counterpartyTypes: ['importer'],
          candidatesWanted: 5,
          deadline: '2026-12-15',
        },
      },
    );
    expect(saved.version).toBe(1);
    const first = await snapshot();
    expect(first.profiles).toHaveLength(1);
    expect(first.commands).toHaveLength(1);
    await migrateSupplySources(populated.owner);
    expect((await registry()).map((r) => r.name)).toEqual([file, second]);
    expect(await snapshot()).toEqual(first);
    // The registry holds both hashes, the second install is a no-op, and the candidate service now answers.
    const rows = await registry();
    await migrateSupplySources(populated.owner);
    expect(await registry()).toEqual(rows);
    expect(
      await candidates.createSource(populated.users.operator.ctx, {
        commandId: randomUUID(),
        kind: 'staff_research',
        status: 'active',
        label: 'After the second file',
        defaultRetentionMonths: 6,
        reason: 'The second file is installed',
      }),
    ).toMatchObject({ version: 1 });
    expect(
      (
        await populated.owner.query('SELECT action FROM app.supply_command ORDER BY created_at')
      ).rows.map((r) => r.action),
    ).toEqual(['save_profile', 'create_source']);
  });
});
