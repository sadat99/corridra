import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerOrganisationProfiles } from './customer-organisation-profile-migrate';
import { migrateCustomerProgrammeTerms } from './customer-programme-terms-migrate';
import { migrateCustomerProgrammeContext } from './customer-programme-context-migrate';
import { migrateCustomerMissionShares } from './customer-mission-share-migrate';
// Explicit optional programme projection/consent lifecycle. The module holds several files: each applied file is
// immutable (its hash is recorded), a correction is a new file, and only files not yet recorded are applied.
export async function migrateCustomerProgrammeProjections(pool: DatabasePool) {
  await migrateCustomerOrganisationProfiles(pool);
  await migrateCustomerProgrammeTerms(pool);
  await migrateCustomerProgrammeContext(pool);
  await migrateCustomerMissionShares(pool);
  const directory = new URL('../customer-programme-projection-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_programme_projection_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_programme_projection_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_programme_projection_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_programme_projection_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Customer programme-projection migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_programme_projection_migrations.applied(name,sha256) VALUES($1,$2)',
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
