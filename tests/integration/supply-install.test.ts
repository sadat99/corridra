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
import { profileWords } from '../../packages/domain/src/counterparty-profiles';

// ADR-082 section 12 and slice S2: the module installs only when its prerequisites are there, installs with its control
// closed, is repeatable, refuses a changed history, replaces no existing function or trigger, and with the module absent
// the application answers that supply sources are not available (never a server error).
const file = '0001_counterparty_profiles.sql';
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
const triggers = async () =>
  (
    await f.owner.query(
      `SELECT c.relname,t.tgname,t.tgfoid::regprocedure::text AS fn FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='app' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY 1,2`,
      [watchedTables],
    )
  ).rows;
const policies = async () =>
  (
    await f.owner.query(
      `SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies WHERE schemaname='app' AND tablename<>ALL($1::text[]) ORDER BY 1,2`,
      [['supply_command', 'counterparty_profile_version', 'supply_source_control']],
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
    const sql = await readFile(
      new URL(`../../packages/db/supply-source-migrations/${file}`, import.meta.url),
      'utf8',
    );
    const rows = await registry();
    expect(rows.map((r) => r.name)).toEqual([file]);
    expect(rows[0].sha256).toBe(createHash('sha256').update(sql).digest('hex'));
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

  test('it replaces no existing function, trigger or policy, and no core migration changes', async () => {
    expect(await definitions()).toEqual(before.definitions);
    expect(await triggers()).toEqual(before.triggers);
    expect(await policies()).toEqual(before.policies);
    expect(
      (await f.owner.query('SELECT name,sha256 FROM migrations.applied ORDER BY name')).rows,
    ).toEqual(before.core);
  });

  test('a changed history is refused and nothing else is applied', async () => {
    await f.owner.query('UPDATE supply_source_migrations.applied SET sha256=$1 WHERE name=$2', [
      'a'.repeat(64),
      file,
    ]);
    expect(await refused(migrateSupplySources(f.owner))).toBe(
      'Supply source migration history mismatch',
    );
    await f.owner.query('UPDATE supply_source_migrations.applied SET sha256=$1 WHERE name=$2', [
      createHash('sha256')
        .update(
          await readFile(
            new URL(`../../packages/db/supply-source-migrations/${file}`, import.meta.url),
            'utf8',
          ),
        )
        .digest('hex'),
      file,
    ]);
    await migrateSupplySources(f.owner);
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
