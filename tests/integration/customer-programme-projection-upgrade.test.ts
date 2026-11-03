import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixture } from './support';
import { migrateCustomerOrganisationProfiles } from '../../packages/db/src/customer-organisation-profile-migrate';
import { migrateCustomerProgrammeTerms } from '../../packages/db/src/customer-programme-terms-migrate';
import { migrateCustomerProgrammeContext } from '../../packages/db/src/customer-programme-context-migrate';
import { migrateCustomerMissionShares } from '../../packages/db/src/customer-mission-share-migrate';
import { migrateCustomerProgrammeProjections } from '../../packages/db/src/customer-programme-projection-migrate';

// The path an environment takes when 0001 is already installed (its hash is recorded, so it may never change)
// and 0002 arrives afterwards: the installer applies 0002 alone, throws no history mismatch, and the three
// functions it replaces keep their owner, access list and settings.
const directory = resolve('packages/db/customer-programme-projection-migrations');
const first = '0001_consented_programme_projections.sql';
const second = '0002_projection_source_and_retention.sql';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const replaced = [
  'customer_private.programme_projection_rows(uuid,uuid)',
  'customer.programme_projection_owner(uuid,uuid,uuid,integer)',
  'customer.programme_projection_own(uuid,uuid)',
];
const untouched = 'customer.programme_projection_command(uuid,text,jsonb)';
let f: Awaited<ReturnType<typeof fixture>>;
const functionState = async (signature: string) =>
  (
    await f.owner.query(
      `SELECT proowner::regrole::text AS owner,proacl::text AS acl,prosecdef AS definer,proconfig::text AS config,
       pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid=$1::regprocedure`,
      [signature],
    )
  ).rows[0];
const structure = async () =>
  (
    await f.owner.query(
      `SELECT (SELECT string_agg(schemaname||'.'||tablename,',' ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname IN ('app','customer','customer_private')) tables,
       (SELECT count(*)::int FROM pg_policies) policies,(SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal) triggers`,
    )
  ).rows[0];
const registry = async () =>
  (
    await f.owner.query<{ name: string; sha256: string; applied_at: Date }>(
      'SELECT name,sha256,applied_at FROM customer_programme_projection_migrations.applied ORDER BY name',
    )
  ).rows;
let before: Awaited<ReturnType<typeof functionState>>[];
let shape: Awaited<ReturnType<typeof structure>>;

beforeAll(async () => {
  f = await fixture('corridra_upgrade_third');
  await migrateCustomerOrganisationProfiles(f.owner);
  await migrateCustomerProgrammeTerms(f.owner);
  await migrateCustomerProgrammeContext(f.owner);
  await migrateCustomerMissionShares(f.owner);
  await f.owner.query('CREATE SCHEMA IF NOT EXISTS customer_programme_projection_migrations');
  await f.owner.query(
    'REVOKE ALL ON SCHEMA customer_programme_projection_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
  );
  await f.owner.query(
    'CREATE TABLE IF NOT EXISTS customer_programme_projection_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  // Install 0001 exactly as the installer did when it was released: the file, then its hash.
  const sql = readFileSync(`${directory}/${first}`, 'utf8');
  await f.owner.query(sql);
  await f.owner.query(
    'INSERT INTO customer_programme_projection_migrations.applied(name,sha256) VALUES($1,$2)',
    [first, sha(sql)],
  );
  before = await Promise.all(replaced.map(functionState));
  shape = await structure();
});
afterAll(async () => {
  await f?.close();
});

describe('upgrading from installed 0001 to the source and retention file', () => {
  test('the released file is exactly the bytes whose hash is recorded in installed databases', () => {
    // Once a projection file is on main it never changes; a correction is always a new file.
    expect(sha(readFileSync(`${directory}/${first}`, 'utf8'))).toBe(
      'dc9430eb0ed5e8a5030fbe17f1f1d6c85e4860c96e43e20ac4fc97529024650b',
    );
  });

  test('0002 refuses to run when a function it replaces has a changed body or security setting', async () => {
    const released = before[0].definition as string;
    await f.owner.query(
      released.replace('SELECT r.id,r.display_label,', 'SELECT r.id,r.display_label, /* drift */'),
    );
    try {
      await expect(migrateCustomerProgrammeProjections(f.owner)).rejects.toThrow(
        'Programme projection prerequisite function differs: customer_private.programme_projection_rows',
      );
      expect((await registry()).map((row) => row.name)).toEqual([first]);
      expect((await functionState(replaced[0]!)).definition).toContain('/* drift */');
    } finally {
      await f.owner.query(released);
    }
    expect(await Promise.all(replaced.map(functionState))).toEqual(before);
    await f.owner.query(`ALTER FUNCTION ${replaced[2]} SECURITY INVOKER`);
    try {
      await expect(migrateCustomerProgrammeProjections(f.owner)).rejects.toThrow(
        'Programme projection prerequisite function differs: customer.programme_projection_own',
      );
      expect((await registry()).map((row) => row.name)).toEqual([first]);
    } finally {
      await f.owner.query(`ALTER FUNCTION ${replaced[2]} SECURITY DEFINER`);
    }
    expect(await Promise.all(replaced.map(functionState))).toEqual(before);
  });

  test('the installer applies 0002 alone, whatever the server renders for the replaced definitions, and again does nothing', async () => {
    const earlier = (await registry())[0]!;
    // A setting that changes how the server prints a definition but not its stored body must not stop the install:
    // servers of different major versions print definitions differently, so the guard compares stored bodies.
    for (const signature of replaced) await f.owner.query(`ALTER FUNCTION ${signature} COST 77`);
    expect(
      (await Promise.all(replaced.map(functionState))).map((state) => state.definition),
    ).not.toEqual(before.map((state) => state.definition));
    await migrateCustomerProgrammeProjections(f.owner);
    const applied = await registry();
    expect(applied.map((row) => row.name)).toEqual([first, second]);
    expect(applied[0]).toEqual(earlier);
    expect(applied[1]!.sha256).toBe(sha(readFileSync(`${directory}/${second}`, 'utf8')));
    await migrateCustomerProgrammeProjections(f.owner);
    expect(await registry()).toEqual(applied);
  });

  test('the replaced functions keep their owner, access list and settings, and nothing else changes', async () => {
    const after = await Promise.all(replaced.map(functionState));
    for (const [index, state] of after.entries()) {
      expect(state.definition).not.toBe(before[index]!.definition);
      expect({ ...state, definition: null }).toEqual({ ...before[index], definition: null });
    }
    expect(before[1]!.acl).toContain('corridra_runtime=X/');
    expect(before[1]!.acl).not.toContain('corridra_auth=');
    expect(before[0]!.acl ?? '').not.toContain('corridra_runtime');
    expect((await functionState(untouched)).definition).toContain('programme_projection_command');
    expect(await structure()).toEqual(shape);
    const grants = (
      await f.owner.query(
        `SELECT p.oid::regprocedure::text signature,has_function_privilege('corridra_runtime',p.oid,'EXECUTE') runtime,
         has_function_privilege('corridra_auth',p.oid,'EXECUTE') auth,has_function_privilege('public',p.oid,'EXECUTE') pub
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname LIKE 'programme_projection_%'`,
      )
    ).rows;
    // Compare as sorted sets: the database orders text by its own collation, which differs between servers.
    expect(
      grants
        .filter((row) => row.runtime)
        .map((row) => row.signature)
        .sort(),
    ).toEqual(
      [
        'customer.programme_projection_command(uuid,text,jsonb)',
        'customer.programme_projection_own(uuid,uuid)',
        'customer.programme_projection_owner(uuid,uuid,uuid,integer)',
      ].sort(),
    );
    expect(grants.some((row) => row.auth || row.pub)).toBe(false);
    const tables = (
      await f.owner.query(
        `SELECT count(*)::int n FROM pg_tables t WHERE schemaname='customer_private' AND tablename LIKE 'programme_projection_%'
         AND (has_table_privilege('corridra_runtime',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE')
         OR has_table_privilege('corridra_auth',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE'))`,
      )
    ).rows[0];
    expect(tables.n).toBe(0);
  });
});
