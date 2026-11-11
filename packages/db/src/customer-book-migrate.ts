import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateCustomerSavedMissions } from './customer-commercial-migrate';
// Optional Trip Book and Supplier Book function (ADR-076). The module holds several files: each applied file is
// immutable (its hash is recorded), a correction is a new file, and only files not yet recorded are applied.
// This installer never enables application exposure: the switch CORRIDRA_UX_BOOKS stays the owner's choice.
export function migrateCustomerBooks(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerBooks', () => migrateCustomerBooksRun(pool));
}

async function migrateCustomerBooksRun(pool: DatabasePool) {
  await migrateCustomerSavedMissions(pool);
  const directory = new URL('../customer-book-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_book_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_book_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_book_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_book_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Customer book migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query('INSERT INTO customer_book_migrations.applied(name,sha256) VALUES($1,$2)', [
        name,
        source.hash,
      ]);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
