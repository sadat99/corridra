import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// ADR-083 slice S1. Explicit optional installation of the sourcing route profile guard and the module control. The control
// starts closed, so installing changes nothing anyone can see. It refuses to run unless the customer real-use module that holds
// the current route pack guard is already installed (it never installs that module itself), and the SQL refuses unless the guard
// definition is exactly the one that module installed. No runtime request receives this owner connection.
export function migrateSourcingWorkflow(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateSourcingWorkflow', () => migrateSourcingWorkflowRun(pool));
}

async function migrateSourcingWorkflowRun(pool: DatabasePool) {
  const directory = new URL('../sourcing-workflow-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    const realUse = await db.query<{ present: boolean }>(
      "SELECT to_regclass('customer_real_use_migrations.applied') IS NOT NULL AS present",
    );
    const done = realUse.rows[0]?.present
      ? (
          await db.query<{ name: string }>('SELECT name FROM customer_real_use_migrations.applied')
        ).rows.map((row) => row.name)
      : [];
    if (!done.some((name) => name.startsWith('0003_')))
      throw new Error(
        'The customer real-use modules are not installed, so the sourcing workflow was not installed. Run the real-use install first.',
      );
    await db.query('CREATE SCHEMA IF NOT EXISTS sourcing_workflow_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA sourcing_workflow_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS sourcing_workflow_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM sourcing_workflow_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('Sourcing workflow migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO sourcing_workflow_migrations.applied(name,sha256) VALUES($1,$2)',
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
