import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { DatabasePool } from './index';
import { migrate } from './migrate';

// Customer authority has an independent admission/rollout lifecycle. Core-only
// installations continue using migrate(); this explicit opt-in installs both.
export async function migrateCustomerAuthority(pool: DatabasePool) {
  await migrate(pool);
  const directory = fileURLToPath(new URL('../customer-migrations/', import.meta.url));
  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const db = await pool.connect();
  let locked = false;
  try {
    await db.query("SELECT pg_advisory_lock(hashtext('corridra:migrations'))");
    locked = true;
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(`CREATE TABLE IF NOT EXISTS customer_migrations.applied(
      name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_migrations.applied ORDER BY name',
    );
    const sources = new Map<string, { sql: string; hash: string }>();
    for (const name of files) {
      const sql = await readFile(`${directory}/${name}`, 'utf8');
      sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
    }
    for (const row of applied.rows) {
      if (!sources.has(row.name))
        throw new Error(`Applied customer migration missing: ${row.name}`);
      if (sources.get(row.name)!.hash !== row.sha256)
        throw new Error(`Applied customer migration changed: ${row.name}`);
    }
    const existing = new Set(applied.rows.map((row) => row.name));
    for (const name of files) {
      if (existing.has(name)) continue;
      if (applied.rows.some((row) => row.name > name))
        throw new Error(`Customer migrations must be appended: ${name}`);
      await db.query('BEGIN');
      try {
        const source = sources.get(name)!;
        await db.query(source.sql);
        await db.query('INSERT INTO customer_migrations.applied(name,sha256) VALUES($1,$2)', [
          name,
          source.hash,
        ]);
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock(hashtext('corridra:migrations'))");
    db.release();
  }
}
