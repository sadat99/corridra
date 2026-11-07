import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';

// Explicit optional installation of the workspace lifecycle (rename, archive, restore, hand over ownership). It changes
// nothing anyone can see: the control it creates starts closed. It never applies the real-use schema itself: when that
// schema is not current it stops with a plain message and writes nothing. File 0003 changes three existing functions,
// each only when its live text is exactly the reviewed text, and skips one that is not installed; file 0004 repeats on
// every run so the programme guard is gated when the programme lifecycle is installed later.
// No runtime request receives this owner connection.
export async function migrateCustomerWorkspaceLifecycle(pool: DatabasePool) {
  const directory = new URL('../customer-workspace-lifecycle-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const realUse = new Map<string, string>();
  const realUseDirectory = new URL('../customer-real-use-migrations/', import.meta.url);
  for (const name of (await readdir(realUseDirectory)).filter((name) => name.endsWith('.sql')))
    realUse.set(
      name,
      createHash('sha256')
        .update(await readFile(new URL(name, realUseDirectory), 'utf8'))
        .digest('hex'),
    );
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    const registry = await db.query<{ present: boolean }>(
      "SELECT to_regclass('customer_real_use_migrations.applied') IS NOT NULL AS present",
    );
    const done = registry.rows[0]?.present
      ? (
          await db.query<{ name: string; sha256: string }>(
            'SELECT name,sha256 FROM customer_real_use_migrations.applied',
          )
        ).rows
      : [];
    for (const [name, hash] of realUse)
      if (!done.some((row) => row.name === name && row.sha256 === hash))
        throw new Error(
          'The customer real-use schema is not current, so the workspace lifecycle was not installed. Install the real-use schema first (real_use_action install).',
        );
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_workspace_lifecycle_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_workspace_lifecycle_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_workspace_lifecycle_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_workspace_lifecycle_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Workspace lifecycle migration history mismatch');
    for (const [name, source] of sources) {
      const recorded = applied.rows.some((row) => row.name === name);
      // A file ending _late is safe to repeat and runs on every install, because it finishes work that depends on an
      // optional module installed after this one. It is recorded once, and a changed file is refused like any other.
      if (recorded && !name.endsWith('_late.sql')) continue;
      await db.query(source.sql);
      if (!recorded)
        await db.query(
          'INSERT INTO customer_workspace_lifecycle_migrations.applied(name,sha256) VALUES($1,$2)',
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

// Runs the install again only when the module is already installed, so that file 0004 can gate a programme guard installed
// after it. It never installs the module: without the registry it does nothing and answers false.
export async function refreshCustomerWorkspaceLifecycle(pool: DatabasePool) {
  const installed = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('customer_workspace_lifecycle_migrations.applied') IS NOT NULL AS present",
  );
  if (!installed.rows[0]?.present) return false;
  await migrateCustomerWorkspaceLifecycle(pool);
  return true;
}
