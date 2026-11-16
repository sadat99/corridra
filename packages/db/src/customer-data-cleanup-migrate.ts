import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateCustomerWorkspaceLifecycle } from './customer-workspace-lifecycle-migrate';

// The text of customer_private.workspace_archived before file 0001 replaced it, exactly as pg_get_functiondef printed it on
// a database built in production order. A rollback re-creates it by a later forward migration (after a data cleanup
// restore); the tests compare the replacement with it on workspaces that were never cleaned.
export const originalWorkspaceArchivedDefinition = `CREATE OR REPLACE FUNCTION customer_private.workspace_archived(target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT coalesce((SELECT r.archived FROM customer_private.workspace_revision r WHERE r.tenant_id=target ORDER BY r.version DESC LIMIT 1),false)
$function$
`;

// Explicit optional installation of the data cleanup archive (U2). It first installs the workspace lifecycle module,
// because a cleanup archive is read through its archive gate; that installer already refuses a real-use schema that is
// not current, and it leaves the lifecycle control as it was (closed on a database that never opened it). Installing
// archives nothing: only an owner-run archive action writes rows. No runtime request receives this owner connection.
export function migrateCustomerDataCleanup(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerDataCleanup', () => migrateCustomerDataCleanupRun(pool));
}

async function migrateCustomerDataCleanupRun(pool: DatabasePool) {
  await migrateCustomerWorkspaceLifecycle(pool);
  const directory = new URL('../customer-data-cleanup-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_data_cleanup_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_data_cleanup_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_data_cleanup_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_data_cleanup_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Data cleanup migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_data_cleanup_migrations.applied(name,sha256) VALUES($1,$2)',
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
