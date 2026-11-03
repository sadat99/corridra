import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { commercialFixture } from './commercial-fixture';
import { future } from './access-fixture';
import { migrateCustomerSavedMissions } from '../../packages/db/src/customer-commercial-migrate';
import { migrateCustomerBooks } from '../../packages/db/src/customer-book-migrate';
import { DeliveryService } from '../../packages/delivery/src/index';
import { CustomerSavedMissionService } from '../../packages/auth/src/customer-saved-missions';
import { admitSyntheticCustomer } from '../../packages/auth/src/customer-admission';

// The Trip Book and Supplier Book module (ADR-076) is optional and additive: it adds one function and nothing
// else. These checks run the installer on a populated environment that has other modules but not this one,
// and prove what it changes, what it must not, and how it refuses a rewritten history.
const issuer = 'https://ep-book-upgrade.neonauth.c-5.eu-central-1.aws.neon.tech/corridra/auth';
const options = { enabled: true, synthetic: true, production: false, issuer };
const file = '0001_trip_and_supplier_books.sql';
const directory = resolve('packages/db/customer-book-migrations');
const signature = 'customer.saved_mission_book(uuid,text,uuid,boolean)';
const releasedHash = '0cb05a75c83fc2a4f5aa0a585a647520bb7849ea14b94cba046b55a751dee84f';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
let f: Awaited<ReturnType<typeof commercialFixture>>;

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
      'SELECT name,sha256,applied_at FROM customer_book_migrations.applied ORDER BY name',
    )
  ).rows;
let before: Awaited<ReturnType<typeof snapshot>>;

beforeAll(async () => {
  f = await commercialFixture();
  await migrateCustomerSavedMissions(f.owner);
  const delivery = new DeliveryService(f.runtime, f.mission, 'synthetic-book-upgrade');
  await admitSyntheticCustomer(f.owner, {
    issuer,
    subject: 'synthetic-book-upgrade',
    executorId: f.serviceId,
    reason: 'Fictional customer book upgrade fixture, never real provider data',
  });
  // Populated: one reviewed mission, one saved invitation and so one row in the saved-mission command ledger.
  const target = await f.target('ES');
  const publication = await delivery.publication(f.users.owner.ctx, {
    commandId: randomUUID(),
    missionId: target.missionId,
    title: 'Approved synthetic mission for the upgrade check',
    company: 'Fictional requesting company',
    objective: 'A populated environment that has no book module yet',
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
    purpose: 'Synthetic book upgrade check',
    expiresAt: future(2),
    allowExport: false,
    approved: true,
  });
  await new CustomerSavedMissionService(f.runtime, f.auth, options, async () => ({
    subject: 'synthetic-book-upgrade',
    emailVerified: true,
    expiresAt: new Date(Date.now() + 3600000),
  })).command({ action: 'save', commandId: randomUUID(), token: link.token, acknowledged: true });
  before = await snapshot();
});
afterAll(async () => {
  await f?.close();
});

describe('installing the book module on a populated environment', () => {
  test('before the install there is no book function and no registry, and the existing ledger has a row', async () => {
    const state = (
      await f.owner.query(
        `SELECT to_regprocedure($1) IS NOT NULL AS function,to_regclass('customer_book_migrations.applied') IS NOT NULL AS registry,
         (SELECT count(*)::int FROM customer_private.saved_mission_command) AS commands`,
        [signature],
      )
    ).rows[0];
    expect(state).toEqual({ function: false, registry: false, commands: 1 });
  });

  test('the installer applies the one file, records its hash, and adds exactly one function', async () => {
    await migrateCustomerBooks(f.owner);
    const applied = await registry();
    expect(applied.map((row) => row.name)).toEqual([file]);
    expect(applied[0]!.sha256).toBe(sha(readFileSync(`${directory}/${file}`, 'utf8')));
    const after = await snapshot();
    const known = new Set(before.functions.map((row) => row.signature));
    expect(
      after.functions.filter((row) => !known.has(row.signature)).map((row) => row.signature),
    ).toEqual([signature]);
    // Every function that existed keeps its body, owner-set options and access list.
    expect(after.functions.filter((row) => known.has(row.signature))).toEqual(before.functions);
    expect(after.policies).toEqual(before.policies);
    expect(after.triggers).toEqual(before.triggers);
    expect(after.tables).toEqual(before.tables);
    expect(after.data).toEqual(before.data);
    expect({ ...after.registries, customer_book_migrations: undefined }).toEqual({
      ...before.registries,
      customer_book_migrations: undefined,
    });
    // The ledger row written before the install is untouched.
    expect(after.data['customer_private.saved_mission_command']).toBe(
      before.data['customer_private.saved_mission_command'],
    );
  });

  test('the new function is for the runtime role only', async () => {
    const row = (
      await f.owner.query(
        `SELECT has_function_privilege('corridra_runtime',$1,'EXECUTE') runtime,has_function_privilege('corridra_auth',$1,'EXECUTE') auth,
         has_function_privilege('public',$1,'EXECUTE') pub,prosecdef definer,proconfig::text config
         FROM pg_proc WHERE oid=$1::regprocedure`,
        [signature],
      )
    ).rows[0];
    expect(row).toMatchObject({ runtime: true, auth: false, pub: false, definer: true });
    expect(row.config).toBe('{search_path=pg_catalog}');
  });

  test('a second install does nothing and keeps the recorded time', async () => {
    const applied = await registry();
    const installed = await snapshot();
    await migrateCustomerBooks(f.owner);
    expect(await registry()).toEqual(applied);
    expect(await snapshot()).toEqual(installed);
  });

  test('an altered or missing applied file stops the installer and changes nothing', async () => {
    const applied = await registry();
    const installed = await snapshot();
    try {
      await f.owner.query(
        "UPDATE customer_book_migrations.applied SET sha256=repeat('0',64) WHERE name=$1",
        [file],
      );
      await expect(migrateCustomerBooks(f.owner)).rejects.toThrow(
        'Customer book migration history mismatch',
      );
    } finally {
      await f.owner.query('UPDATE customer_book_migrations.applied SET sha256=$2 WHERE name=$1', [
        file,
        applied[0]!.sha256,
      ]);
    }
    try {
      await f.owner.query(
        "INSERT INTO customer_book_migrations.applied(name,sha256) VALUES('9999_missing.sql',repeat('f',64))",
      );
      await expect(migrateCustomerBooks(f.owner)).rejects.toThrow(
        'Customer book migration history mismatch',
      );
    } finally {
      await f.owner.query(
        "DELETE FROM customer_book_migrations.applied WHERE name='9999_missing.sql'",
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
    expect(script).toContain("'customer_book_migrations',");
    expect(script).toContain("['trip and supplier books', migrateCustomerBooks]");
    expect(script).toContain(
      "import { migrateCustomerBooks } from '../packages/db/src/customer-book-migrate';",
    );
    // Installing the module never switches anything on: the installer touches no configuration.
    expect(readFileSync('packages/db/src/customer-book-migrate.ts', 'utf8')).not.toMatch(
      /process\.env/,
    );
  });
});
