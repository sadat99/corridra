import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// ADR-093 Phase 2a. Explicit optional installation of one-person route publication: one person may propose and publish a
// route pack, record its readiness and release it. It refuses to run unless the customer real-use module that holds the current
// operations guard is already installed (it never installs that module itself), and the SQL refuses unless the guard definition
// is exactly the one that module installed. It opens no gate. Only top-level .sql files are applied; the rollback directory is
// never run here. No runtime request receives this owner connection.
// `through` (a four digit prefix such as '0001') stops after that file, so 2a can be installed without 2b. Every source is still
// loaded and every history row is still verified against its source, so a changed later file stops a partial run too.
export type RoutePackOptions = { through?: string };

export function migrateRoutePack(pool: DatabasePool, options: RoutePackOptions = {}) {
  // The key carries `through`, so a 2a-only call in one installer run can never make a later full call skip 0002.
  return migrateOnce(pool, `migrateRoutePack:${options.through ?? 'all'}`, () =>
    migrateRoutePackRun(pool, options),
  );
}

// The one file a `through` value names: exactly four digits and exactly one top-level file with that prefix, else a plain error.
export function routePackThroughFile(names: string[], through: string) {
  const matches = /^\d{4}$/.test(through)
    ? names.filter((name) => name.startsWith(`${through}_`))
    : [];
  if (matches.length !== 1)
    throw new Error(`Unknown route pack migration to install through: ${through}`);
  return matches[0]!;
}

async function migrateRoutePackRun(pool: DatabasePool, options: RoutePackOptions) {
  const directory = new URL('../route-pack-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const last =
    options.through === undefined
      ? undefined
      : routePackThroughFile([...sources.keys()], options.through);
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
        'The customer real-use modules are not installed, so route pack publication was not installed. Run the real-use install first.',
      );
    await db.query('CREATE SCHEMA IF NOT EXISTS route_pack_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA route_pack_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS route_pack_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM route_pack_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('Route pack migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      if (last !== undefined && name > last) continue;
      await db.query(source.sql);
      await db.query('INSERT INTO route_pack_migrations.applied(name,sha256) VALUES($1,$2)', [
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
