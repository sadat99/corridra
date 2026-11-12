import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateCustomerAccountLifecycle } from './customer-account-lifecycle-migrate';
import { migrateCustomerProgrammePublication } from './customer-programme-publication-migrate';
import { migrateCustomerParticipantLabels } from './customer-participant-label-migrate';

// Explicit optional installation of the redaction of programme application and registration words under an erasure request.
// It installs the account lifecycle (erasure tables and scope), the programme pages and the participant label modules first,
// because it changes the append-only guard of tables those modules create. Each of those installers refuses a real-use schema
// that is not current, so this one never applies it either. There is no control table: installing is the whole activation, and
// nothing changes for anyone until staff run the removal under an erasure request. No runtime request receives this connection.
export function migrateCustomerProgrammeErasure(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerProgrammeErasure', () =>
    migrateCustomerProgrammeErasureRun(pool),
  );
}

async function migrateCustomerProgrammeErasureRun(pool: DatabasePool) {
  await migrateCustomerAccountLifecycle(pool);
  await migrateCustomerProgrammePublication(pool);
  await migrateCustomerParticipantLabels(pool);
  const directory = new URL('../customer-programme-erasure-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_programme_erasure_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_programme_erasure_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_programme_erasure_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_programme_erasure_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Programme erasure migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_programme_erasure_migrations.applied(name,sha256) VALUES($1,$2)',
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
