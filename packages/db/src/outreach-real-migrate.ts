import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';

// ADR-090. Explicit optional installation of the real email lane for introductions. It refuses to run unless the customer
// real-use modules through 0020 are already installed (it never installs them itself), and the SQL refuses unless the three
// functions it replaces and the receipt check are exactly the definitions it names. It sends nothing and turns nothing on:
// the switch, the mode and every workspace policy are separate. No runtime request receives this owner connection.
export function migrateOutreachReal(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateOutreachReal', () => migrateOutreachRealRun(pool));
}

async function migrateOutreachRealRun(pool: DatabasePool) {
  const directory = new URL('../outreach-real-migrations/', import.meta.url);
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
    if (!done.some((name) => name >= '0020_'))
      throw new Error(
        'The customer real-use modules are not installed, so the real outreach module was not installed. Run the real-use install first.',
      );
    await db.query('CREATE SCHEMA IF NOT EXISTS outreach_real_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA outreach_real_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS outreach_real_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM outreach_real_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error('Real outreach migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query('INSERT INTO outreach_real_migrations.applied(name,sha256) VALUES($1,$2)', [
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
