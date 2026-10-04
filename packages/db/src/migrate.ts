import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
export async function migrate(pool: Pool, through?: string) {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  const db = await pool.connect();
  try {
    await db.query("SELECT pg_advisory_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS migrations');
    await db.query(
      'CREATE TABLE IF NOT EXISTS migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
      if (through && name > through) break;
      const sql = await readFile(`${dir}/${name}`, 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const old = await db.query('SELECT sha256 FROM migrations.applied WHERE name=$1', [name]);
      if (old.rowCount) {
        if (old.rows[0].sha256 !== hash) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await db.query('BEGIN');
      try {
        await db.query(sql);
        await db.query('INSERT INTO migrations.applied(name,sha256) VALUES($1,$2)', [name, hash]);
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock(hashtext('corridra:migrations'))");
    db.release();
  }
}
