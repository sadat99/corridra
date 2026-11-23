import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// Explicit optional installation of the real intake owner module (B11a, owner decision 23 Nov 2026). Installing it
// changes no owner: with no owner version recorded, new real requests keep the owner in the real-use configuration. It never
// applies the real-use schema itself: when that schema is not current it stops with a plain message and writes nothing.
// No runtime request receives this owner connection.
export function migrateCustomerRealIntakeOwner(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerRealIntakeOwner', () =>
    migrateCustomerRealIntakeOwnerRun(pool),
  );
}

async function readFiles() {
  const directory = new URL('../customer-real-intake-owner-migrations/', import.meta.url);
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
  return { sources, realUse };
}

export type RealIntakeOwnerInstallPreview = {
  state: 'installed' | 'would be installed' | 'refused';
  refusal?: string;
};

// Read only, for the installer's dry run: whether an install would go through, checked the way the install itself checks
// (the real-use schema is current, and every function this module replaces is still the text its file pins by hash). It
// runs in a read-only transaction that is always rolled back.
export async function previewCustomerRealIntakeOwnerInstall(
  pool: DatabasePool,
): Promise<RealIntakeOwnerInstallPreview> {
  const { sources, realUse } = await readFiles();
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    const present = async (name: string) =>
      (
        await db.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [
          name,
        ])
      ).rows[0]!.present;
    const applied = (await present('customer_real_intake_owner_migrations.applied'))
      ? (
          await db.query<{ name: string; sha256: string }>(
            'SELECT name,sha256 FROM customer_real_intake_owner_migrations.applied',
          )
        ).rows
      : [];
    for (const row of applied)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        return { state: 'refused', refusal: 'Real intake owner migration history mismatch' };
    const waiting = [...sources].filter(([name]) => !applied.some((row) => row.name === name));
    if (!waiting.length) return { state: 'installed' };
    const done = (await present('customer_real_use_migrations.applied'))
      ? (
          await db.query<{ name: string; sha256: string }>(
            'SELECT name,sha256 FROM customer_real_use_migrations.applied',
          )
        ).rows
      : [];
    for (const [name, hash] of realUse)
      if (!done.some((row) => row.name === name && row.sha256 === hash))
        return { state: 'refused', refusal: 'the customer real-use schema is not current' };
    for (const [, source] of waiting)
      for (const pinned of source.sql.matchAll(
        /pg_get_functiondef\('([^']+)'::regprocedure\),'UTF8'\)\),'hex'\)<>'([a-f0-9]{64})'/g,
      )) {
        const now = await db.query<{ hash: string | null }>(
          "SELECT encode(sha256(convert_to(pg_get_functiondef(to_regprocedure($1)),'UTF8')),'hex') AS hash",
          [pinned[1]],
        );
        if (now.rows[0]?.hash !== pinned[2])
          return {
            state: 'refused',
            refusal: `${pinned[1]!.split('(')[0]} is not the text this module was written against`,
          };
      }
    return { state: 'would be installed' };
  } finally {
    await db.query('ROLLBACK');
    db.release();
  }
}

async function migrateCustomerRealIntakeOwnerRun(pool: DatabasePool) {
  const { sources, realUse } = await readFiles();
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
          'The customer real-use schema is not current, so the real intake owner module was not installed. Install the real-use schema first (real_use_action install).',
        );
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_real_intake_owner_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_real_intake_owner_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_real_intake_owner_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_real_intake_owner_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Real intake owner migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_real_intake_owner_migrations.applied(name,sha256) VALUES($1,$2)',
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
