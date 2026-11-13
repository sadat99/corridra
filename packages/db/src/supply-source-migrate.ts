import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabaseClient, DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// Explicit optional installation of the supply sources module (ADR-082, slice S2 onward). Its `module` control starts
// closed, so installing changes nothing anyone can see. Unlike most optional modules it installs no other module for the
// owner: it refuses, with the exact step to run first, unless the core research, communication, policy and network
// migrations, the whole real-use ladder, the network real-use module and the service-request module are already installed.
// "Whole" means every file the repository holds for that module, so a newer file added later is required too.
// Builds never run this. No runtime request receives this owner connection.
export function migrateSupplySources(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateSupplySources', () => migrateSupplySourcesRun(pool));
}

const sqlFiles = async (directory: URL) =>
  (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();

// Core migrations are matched by their number prefix, as the contact change module does.
const corePrefixes = ['0008_', '0009_', '0022_', '0027_'];
const dependencies = [
  {
    schema: 'customer_real_use_migrations',
    directory: '../customer-real-use-migrations/',
    refusal: 'Install the real-use modules first (real_use_action=install).',
  },
  {
    schema: 'network_real_use_migrations',
    directory: '../network-real-use-migrations/',
    refusal: 'Install the network real-use module first (network_use_action=install).',
  },
  {
    schema: 'customer_service_request_migrations',
    directory: '../customer-service-request-migrations/',
    refusal:
      'Install the service request module first (it is installed with the real-use modules by real_use_action=install).',
  },
];

async function appliedNames(db: DatabaseClient, schema: string) {
  const present = await db.query<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [`${schema}.applied`],
  );
  if (!present.rows[0]?.present) return [];
  return (await db.query<{ name: string }>(`SELECT name FROM ${schema}.applied`)).rows.map(
    (row) => row.name,
  );
}

async function migrateSupplySourcesRun(pool: DatabasePool) {
  const directory = new URL('../supply-source-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of await sqlFiles(directory)) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    const core = await appliedNames(db, 'migrations');
    for (const prefix of corePrefixes)
      if (!core.some((name) => name.startsWith(prefix)))
        throw new Error(
          'The core research, communication, policy and network schema is not installed, so supply sources were not installed. Run the core migrations first.',
        );
    for (const need of dependencies) {
      const done = await appliedNames(db, need.schema);
      for (const name of await sqlFiles(new URL(need.directory, import.meta.url)))
        if (!done.includes(name)) throw new Error(need.refusal);
    }
    await db.query('CREATE SCHEMA IF NOT EXISTS supply_source_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA supply_source_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS supply_source_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM supply_source_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('Supply source migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query('INSERT INTO supply_source_migrations.applied(name,sha256) VALUES($1,$2)', [
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
