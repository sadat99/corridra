import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabaseClient, DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// Explicit optional installation of the private profile picture module (ADR-088). Installing it changes nothing anyone can
// see: the picture controls stay hidden until the profilePicture capability is switched on by review. It installs no other
// module: it refuses, with the exact step to run first, unless every personal profile file the repository holds is applied,
// because it uses that module's account refusals, workspace check and event writer (and through it the account lifecycle).
// Each applied file is immutable (its hash is recorded) and a correction is a new file. Builds never run this. No runtime
// request receives this owner connection.
export function migrateCustomerProfilePictures(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerProfilePictures', () =>
    migrateCustomerProfilePicturesRun(pool),
  );
}

export const profilePicturePersonalProfileStep =
  'Install the personal profile module first (field_modules_action=personal_profile).';

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

async function migrateCustomerProfilePicturesRun(pool: DatabasePool) {
  const directory = new URL('../customer-profile-picture-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of await sqlFiles(directory)) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    const done = await appliedNames(db, 'customer_personal_profile_migrations');
    for (const name of await sqlFiles(
      new URL('../customer-personal-profile-migrations/', import.meta.url),
    ))
      if (!done.includes(name)) throw new Error(profilePicturePersonalProfileStep);
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_profile_picture_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_profile_picture_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_profile_picture_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_profile_picture_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('Profile picture migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_profile_picture_migrations.applied(name,sha256) VALUES($1,$2)',
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
