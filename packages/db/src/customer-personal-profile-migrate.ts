import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabaseClient, DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// Explicit optional installation of the private personal details module (ADR-086). Installing it changes nothing anyone
// can see: the account page shows the details only once the module answers. It installs no other module: it refuses, with
// the exact step to run first, unless every account lifecycle file the repository holds is applied, because the events it
// writes are anchored to the account chain workspace of that module and the staff removal uses its erasure authority.
// Each applied file is immutable (its hash is recorded) and a correction is a new file. Builds never run this. No runtime
// request receives this owner connection.
export function migrateCustomerPersonalProfiles(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerPersonalProfiles', () =>
    migrateCustomerPersonalProfilesRun(pool),
  );
}

export const personalProfileLifecycleStep =
  'Install the account lifecycle modules first (field_modules_action=lifecycle_install).';

const sqlFiles = async (directory: URL) =>
  (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

async function appliedNames(db: DatabaseClient, schema: string) {
  const present = await db.query<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [`${schema}.applied`],
  );
  if (!present.rows[0]?.present) return [];
  return (await db.query<{ name: string }>(`SELECT name FROM ${schema}.applied`)).rows.map(
    (row) => row.name,
  );
}

async function migrateCustomerPersonalProfilesRun(pool: DatabasePool) {
  const directory = new URL('../customer-personal-profile-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of await sqlFiles(directory)) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    const done = await appliedNames(db, 'customer_account_lifecycle_migrations');
    for (const name of await sqlFiles(
      new URL('../customer-account-lifecycle-migrations/', import.meta.url),
    ))
      if (!done.includes(name)) throw new Error(personalProfileLifecycleStep);
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_personal_profile_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_personal_profile_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_personal_profile_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_personal_profile_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('Personal profile migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_personal_profile_migrations.applied(name,sha256) VALUES($1,$2)',
        [name, source.hash],
      );
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
