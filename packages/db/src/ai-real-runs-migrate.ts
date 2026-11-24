import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// ADR-091. Explicit optional installation of AI runs, results and reviews for real workspaces: the whole family in
// ai-model-policy-real-migrations, so the ADR-089 step first when it is missing and then the second step. It refuses unless
// the customer real-use modules and the network real-use module are already installed (it never installs them itself), and
// the SQL refuses unless each of the three functions it replaces is exactly the pinned definition. The control it adds
// starts closed, so installing changes nothing anyone can see. No runtime request receives this owner connection.
export function migrateAiRealRuns(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateAiRealRuns', () => migrateAiRealRunsRun(pool));
}

async function migrateAiRealRunsRun(pool: DatabasePool) {
  const directory = new URL('../ai-model-policy-real-migrations/', import.meta.url);
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
    if (!done.some((name) => name >= '0002_'))
      throw new Error(
        'The customer real-use modules are not installed, so AI for real workspaces was not installed. Run the real-use install first.',
      );
    const network = await db.query<{ present: boolean }>(
      "SELECT to_regclass('network_real_use_migrations.applied') IS NOT NULL AS present",
    );
    const networkDone = network.rows[0]?.present
      ? (await db.query('SELECT 1 FROM network_real_use_migrations.applied LIMIT 1')).rowCount
      : 0;
    if (!networkDone)
      throw new Error(
        'The network real-use module is not installed, so AI for real workspaces was not installed. Run the network real-use install first (network_use_action=install).',
      );
    await db.query('CREATE SCHEMA IF NOT EXISTS ai_model_policy_real_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA ai_model_policy_real_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS ai_model_policy_real_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM ai_model_policy_real_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('AI model policy migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO ai_model_policy_real_migrations.applied(name,sha256) VALUES($1,$2)',
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
