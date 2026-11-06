import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerRealUse } from './customer-real-use-migrate';

// Explicit optional installation of recipient response revision (CRUD gap G7, module 3). It adds one append-only table and two
// functions and replaces the recipient's own view behind a hash guard of the definition it replaces. It never installs anything
// else, and no runtime request receives this owner connection.
export async function migrateRecipientResponseRevision(pool: DatabasePool) {
  // Its read policies come in the usual pair (sample and real use), so the real-use functions must exist.
  // Installing them changes nothing anyone can see.
  await migrateCustomerRealUse(pool);
  const directory = new URL('../recipient-response-revision-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS recipient_response_revision_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA recipient_response_revision_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS recipient_response_revision_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM recipient_response_revision_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Recipient response revision migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO recipient_response_revision_migrations.applied(name,sha256) VALUES($1,$2)',
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
