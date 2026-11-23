import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateCustomerAuthority } from './customer-migrate';

// Short request references (RQ-000001). It first installs the customer authority module, which holds the request
// table, the membership helper and the request actor this module reads. The module holds one side table, one
// trigger on new requests and one read function; it alters no existing table and rewrites no existing row.
// Each applied file is immutable (its hash is recorded), a correction is a new file, and only files not yet
// recorded are applied. There is no control table and no application switch: installing it shows nothing by itself.
export function migrateCustomerRequestReferences(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerRequestReferences', () =>
    migrateCustomerRequestReferencesRun(pool),
  );
}

async function migrateCustomerRequestReferencesRun(pool: DatabasePool) {
  await migrateCustomerAuthority(pool);
  const directory = new URL('../customer-request-reference-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_request_reference_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_request_reference_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_request_reference_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_request_reference_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Request reference migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_request_reference_migrations.applied(name,sha256) VALUES($1,$2)',
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
