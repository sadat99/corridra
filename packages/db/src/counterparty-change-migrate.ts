import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// Explicit optional installation of withdraw, correct and hide for private contacts and notes (CRUD G11, ADR-017
// amendment). Its control starts closed, so installing changes nothing anyone can see. It needs only the core research
// and communication tables (core migrations 0008 and 0009), never the real-use schema: real-use workspaces work the same
// way because each change inherits the provenance of the record it changes.
// No runtime request receives this owner connection.
export function migrateCounterpartyChanges(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCounterpartyChanges', () => migrateCounterpartyChangesRun(pool));
}

async function migrateCounterpartyChangesRun(pool: DatabasePool) {
  const directory = new URL('../counterparty-change-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    const core = await db.query<{ present: boolean }>(
      "SELECT to_regclass('migrations.applied') IS NOT NULL AS present",
    );
    const done = core.rows[0]?.present
      ? (await db.query<{ name: string }>('SELECT name FROM migrations.applied')).rows.map(
          (row) => row.name,
        )
      : [];
    for (const prefix of ['0008_', '0009_'])
      if (!done.some((name) => name.startsWith(prefix)))
        throw new Error(
          'The core research and communication schema is not installed, so contact and note changes were not installed. Run the core migrations first.',
        );
    await db.query('CREATE SCHEMA IF NOT EXISTS counterparty_change_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA counterparty_change_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS counterparty_change_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM counterparty_change_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('Contact and note change migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO counterparty_change_migrations.applied(name,sha256) VALUES($1,$2)',
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
