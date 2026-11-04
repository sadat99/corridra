import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { future } from './access-fixture';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerDecisions } from '../../packages/db/src/customer-decision-migrate';
import { migrateCustomerDelivery } from '../../packages/db/src/customer-delivery-migrate';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerMemberRoles } from '../../packages/db/src/customer-member-role-migrate';
import { migrateCustomerDecisionCards } from '../../packages/db/src/customer-decision-card-migrate';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';

// The decision card module (ADR-076 item 4) is optional and additive: it adds three tables and a set of functions
// and replaces nothing. These checks run the installer on a fresh database and on a populated environment that
// has the modules it needs but not this one, and prove what it adds, what it must not touch, and how it refuses
// a rewritten history.
const issuer = 'https://ep-card-upgrade.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const file = '0001_decision_cards.sql';
const directory = resolve('packages/db/customer-decision-card-migrations');
const releasedHash = '0772e61db198d385b0d1028ea217cba32b2e8999ddf0cd3cbba8ecdac158c469';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
// Everything the file may add, and nothing else.
const addedFunctions = [
  'app.read_decision_card(text)',
  'customer.create_decision_card(uuid,uuid,uuid,text,text,timestamp with time zone)',
  'customer.decision_card_preview(uuid,uuid)',
  'customer.decision_card_state(uuid)',
  'customer.withdraw_decision_card(uuid,uuid)',
  'customer_private.decision_card_hourly_limit()',
  'customer_private.decision_card_iso(timestamp with time zone)',
  'customer_private.decision_card_lifetime()',
  'customer_private.decision_card_max_active()',
  'customer_private.decision_card_resolve(uuid,uuid,uuid)',
  'customer_private.decision_card_summary(customer_private.decision_card)',
  'customer_private.decision_card_workspace(uuid,uuid)',
  'customer_private.guard_decision_card_open()',
];
const granted = [
  'app.read_decision_card(text)',
  'customer.create_decision_card(uuid,uuid,uuid,text,text,timestamp with time zone)',
  'customer.decision_card_preview(uuid,uuid)',
  'customer.decision_card_state(uuid)',
  'customer.withdraw_decision_card(uuid,uuid)',
];
const addedTables = [
  'customer_private.decision_card',
  'customer_private.decision_card_open',
  'customer_private.decision_card_withdrawal',
];
const addedTriggers = [
  'customer_private.decision_card.decision_card_immutable',
  'customer_private.decision_card_open.decision_card_open_guard',
  'customer_private.decision_card_withdrawal.decision_card_withdrawal_immutable',
];
let f: Awaited<ReturnType<typeof commercialFixture>>;
let freshApplied: { name: string; sha256: string }[];
let freshRegistries: string[];

async function snapshot() {
  const functions = (
    await f.owner.query(
      `SELECT p.oid::regprocedure::text signature,p.proacl::text acl,p.prosecdef definer,p.proconfig::text config,pg_get_functiondef(p.oid) definition
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','identity','customer','customer_private') AND p.prokind='f'`,
    )
  ).rows as {
    signature: string;
    acl: string;
    definer: boolean;
    config: string;
    definition: string;
  }[];
  const policies = (
    await f.owner.query(
      "SELECT to_jsonb(p) policy FROM pg_policies p WHERE schemaname IN ('app','identity','customer','customer_private')",
    )
  ).rows.map((row) => JSON.stringify(row.policy));
  const triggers = (
    await f.owner.query(
      "SELECT tgrelid::regclass::text||'.'||tgname AS name FROM pg_trigger WHERE NOT tgisinternal",
    )
  ).rows.map((row) => row.name as string);
  const tables = (
    await f.owner.query(
      `SELECT format('%I.%I',n.nspname,c.relname) name,c.relacl::text acl,c.relrowsecurity rls
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('app','identity','customer','customer_private')`,
    )
  ).rows as { name: string; acl: string; rls: boolean }[];
  const data: Record<string, string> = {};
  for (const table of tables)
    data[table.name] = (
      await f.owner.query(
        `SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY to_jsonb(v)::text)::text,'')) digest FROM ${table.name} v`,
      )
    ).rows[0].digest;
  const registries: Record<string, unknown[]> = {};
  for (const schema of (
    await f.owner.query(
      "SELECT nspname FROM pg_namespace WHERE nspname='migrations' OR nspname LIKE 'customer%\\_migrations' ORDER BY 1",
    )
  ).rows.map((row) => row.nspname as string))
    registries[schema] = (
      await f.owner.query(`SELECT * FROM ${schema}.applied ORDER BY name`)
    ).rows;
  return {
    functions: functions.sort((a, b) => a.signature.localeCompare(b.signature)),
    policies: policies.sort(),
    triggers: triggers.sort(),
    tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    data,
    registries,
  };
}
const registry = async () =>
  (
    await f.owner.query<{ name: string; sha256: string; applied_at: Date }>(
      'SELECT name,sha256,applied_at FROM customer_decision_card_migrations.applied ORDER BY name',
    )
  ).rows;
// What the installer report prints for this module: "not installed" or "<n> applied".
const report = async (database: typeof f.owner) => {
  const present = (
    await database.query(
      "SELECT to_regclass('customer_decision_card_migrations.applied') IS NOT NULL AS present",
    )
  ).rows[0].present;
  if (!present) return 'customer_decision_card_migrations: not installed';
  const rows = await database.query(
    'SELECT count(*)::text AS n FROM customer_decision_card_migrations.applied',
  );
  return `customer_decision_card_migrations: ${rows.rows[0].n} applied`;
};
let before: Awaited<ReturnType<typeof snapshot>>;

beforeAll(async () => {
  // A fresh database: the installer alone brings the modules it needs and then applies its one file.
  const fresh = await commercialFixture();
  await migrateCustomerDecisionCards(fresh.owner);
  freshApplied = (
    await fresh.owner.query('SELECT name,sha256 FROM customer_decision_card_migrations.applied')
  ).rows;
  freshRegistries = (
    await fresh.owner.query(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'customer%\\_migrations' ORDER BY 1",
    )
  ).rows.map((row) => row.nspname as string);
  await fresh.close();

  // A populated environment that has the prerequisite modules and one saved report, but no card registry.
  f = await commercialFixture();
  await migrateCustomerSavedMissions(f.owner);
  const delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-card-upgrade');
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'synthetic-card-upgrade',
    executorId: f.serviceId,
    reason: 'Fictional customer card upgrade fixture, never real provider data',
  });
  const target = await f.target('ES');
  const publication = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: target.missionId,
    title: 'Approved synthetic mission for the upgrade check',
    company: 'Fictional requesting company',
    objective: 'A populated environment that has no card module yet',
    brief: 'Approved summary without private supplier contacts',
    nextAction: 'Wait for the review',
    dueAt: future(),
    meetings: [],
    opportunityIds: [],
    includeFinancials: false,
    approved: true,
  });
  const link = await delivery.share(f.users.owner.ctx, {
    commandId: randomUUID(),
    programmeId: null,
    publicationIds: [publication.id],
    audience: 'CLIENT_PROGRESS',
    purpose: 'Synthetic card upgrade check',
    expiresAt: future(2),
    allowExport: false,
    approved: true,
  });
  await new CustomerSavedMissionService(
    f.runtime,
    f.auth,
    {
      enabled: true,
      synthetic: true,
      production: false,
      issuer,
    },
    async () => ({
      subject: 'synthetic-card-upgrade',
      emailVerified: true,
      expiresAt: new Date(Date.now() + 3600000),
    }),
  ).command({ action: 'save', commandId: randomUUID(), token: link.token, acknowledged: true });
  await migrateCustomerDecisions(f.owner);
  await migrateCustomerDelivery(f.owner);
  await migrateCustomerOrganisationProfiles(f.owner);
  await migrateCustomerMemberRoles(f.owner);
  before = await snapshot();
}, 180000);
afterAll(async () => {
  await f?.close();
});

describe('a fresh database', () => {
  test('the installer brings its prerequisites and applies its one file, recording the hash', () => {
    expect(freshApplied.map((row) => row.name)).toEqual([file]);
    expect(freshApplied[0]!.sha256).toBe(sha(readFileSync(`${directory}/${file}`, 'utf8')));
    for (const schema of [
      'customer_commercial_migrations',
      'customer_decision_migrations',
      'customer_delivery_migrations',
      'customer_organisation_profile_migrations',
      'customer_member_role_migrations',
    ])
      expect(freshRegistries).toContain(schema);
  });
});

describe('installing the decision card module on a populated environment', () => {
  test('before the install there is no card object and no registry, and the existing ledger has a row', async () => {
    const state = (
      await f.owner.query(
        `SELECT to_regclass('customer_private.decision_card') IS NOT NULL AS table,
         to_regprocedure('customer.create_decision_card(uuid,uuid,uuid,text,text,timestamp with time zone)') IS NOT NULL AS function,
         (SELECT count(*)::int FROM customer_private.saved_mission) AS saved`,
      )
    ).rows[0];
    expect(state).toEqual({ table: false, function: false, saved: 1 });
    expect(await report(f.owner)).toBe('customer_decision_card_migrations: not installed');
  });

  test('the installer applies the one file, records its hash and reports one applied', async () => {
    await migrateCustomerDecisionCards(f.owner);
    expect(await report(f.owner)).toBe('customer_decision_card_migrations: 1 applied');
    const applied = await registry();
    expect(applied.map((row) => row.name)).toEqual([file]);
    expect(applied[0]!.sha256).toBe(sha(readFileSync(`${directory}/${file}`, 'utf8')));
  });

  test('exactly the new objects appear and every existing function, policy, table and row is unchanged', async () => {
    const after = await snapshot();
    const known = new Set(before.functions.map((row) => row.signature));
    expect(
      after.functions
        .filter((row) => !known.has(row.signature))
        .map((row) => row.signature)
        .sort(),
    ).toEqual([...addedFunctions].sort());
    // Every function that existed keeps its body, owner-set options and access list.
    expect(after.functions.filter((row) => known.has(row.signature))).toEqual(before.functions);
    expect(after.policies).toEqual(before.policies);
    const knownTriggers = new Set(before.triggers);
    expect(after.triggers.filter((name) => !knownTriggers.has(name))).toEqual(
      [...addedTriggers].sort(),
    );
    expect(after.triggers.filter((name) => knownTriggers.has(name))).toEqual(before.triggers);
    const knownTables = new Set(before.tables.map((row) => row.name));
    expect(after.tables.filter((row) => !knownTables.has(row.name)).map((row) => row.name)).toEqual(
      addedTables,
    );
    expect(after.tables.filter((row) => knownTables.has(row.name))).toEqual(before.tables);
    for (const table of knownTables) expect(after.data[table]).toBe(before.data[table]);
    // The new tables are empty, have row level security on and carry no grant at all.
    for (const table of after.tables.filter((row) => !knownTables.has(row.name))) {
      expect(table.rls).toBe(true);
      expect(table.acl ?? '').not.toMatch(/corridra_|(^\{|,)=/);
    }
    for (const table of addedTables)
      expect((await f.owner.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n).toBe(0);
    expect({ ...after.registries, customer_decision_card_migrations: undefined }).toEqual({
      ...before.registries,
      customer_decision_card_migrations: undefined,
    });
  });

  test('nothing is created or replaced: the file contains no CREATE OR REPLACE and no ALTER of an existing object', () => {
    const sql = readFileSync(`${directory}/${file}`, 'utf8');
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/ALTER\s+(FUNCTION|POLICY)/i);
    expect(sql.includes(String.fromCharCode(0x2014))).toBe(false);
  });

  test('the five functions are for the runtime role only; the helpers are for nobody', async () => {
    const rows = [];
    for (const name of addedFunctions)
      rows.push(
        (
          await f.owner.query(
            `SELECT $1::text signature,has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,
             has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth,has_function_privilege('public',p.oid,'EXECUTE') pub,
             p.prosecdef definer,p.proconfig::text config FROM pg_proc p WHERE p.oid=$1::regprocedure`,
            [name],
          )
        ).rows[0],
      );
    expect(rows).toHaveLength(addedFunctions.length);
    for (const row of rows) {
      expect(row.runtime).toBe(granted.includes(row.signature));
      expect(row.auth).toBe(false);
      expect(row.pub).toBe(false);
      if (row.runtime) {
        expect(row.definer).toBe(true);
        expect(row.config).toBe('{search_path=pg_catalog}');
      }
    }
  });

  test('a second install does nothing and keeps the recorded time', async () => {
    const applied = await registry();
    const installed = await snapshot();
    await migrateCustomerDecisionCards(f.owner);
    expect(await registry()).toEqual(applied);
    expect(await snapshot()).toEqual(installed);
  });

  test('an altered or missing applied file stops the installer and changes nothing', async () => {
    const applied = await registry();
    const installed = await snapshot();
    try {
      await f.owner.query(
        "UPDATE customer_decision_card_migrations.applied SET sha256=repeat('0',64) WHERE name=$1",
        [file],
      );
      await expect(migrateCustomerDecisionCards(f.owner)).rejects.toThrow(
        'Customer decision card migration history mismatch',
      );
    } finally {
      await f.owner.query(
        'UPDATE customer_decision_card_migrations.applied SET sha256=$2 WHERE name=$1',
        [file, applied[0]!.sha256],
      );
    }
    try {
      await f.owner.query(
        "INSERT INTO customer_decision_card_migrations.applied(name,sha256) VALUES('9999_missing.sql',repeat('f',64))",
      );
      await expect(migrateCustomerDecisionCards(f.owner)).rejects.toThrow(
        'Customer decision card migration history mismatch',
      );
    } finally {
      await f.owner.query(
        "DELETE FROM customer_decision_card_migrations.applied WHERE name='9999_missing.sql'",
      );
    }
    expect(await registry()).toEqual(applied);
    expect(await snapshot()).toEqual(installed);
  });

  test('the released file is exactly the bytes whose hash installed databases record', () => {
    // Once the file is on main it never changes; a correction is always a new file.
    expect(sha(readFileSync(`${directory}/${file}`, 'utf8'))).toBe(releasedHash);
  });

  test('the install job knows the module: a registry line in the report and an installer entry', () => {
    const script = readFileSync('scripts/install-customer-modules.ts', 'utf8');
    expect(script).toContain("'customer_decision_card_migrations',");
    expect(script).toContain("['decision cards', migrateCustomerDecisionCards]");
    expect(script).toContain(
      "import { migrateCustomerDecisionCards } from '../packages/db/src/customer-decision-card-migrate';",
    );
    // Installing the module never switches anything on: the installer touches no configuration.
    expect(readFileSync('packages/db/src/customer-decision-card-migrate.ts', 'utf8')).not.toMatch(
      /process\.env/,
    );
  });
});
