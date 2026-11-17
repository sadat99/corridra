import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';

export type ViewerModule = { directory: URL; schema: string; label: string };

// Shared by the two ADR-087 viewer modules (U2 and U3). Same registry shape and history check as every optional module.
export async function migrateViewerModule(pool: DatabasePool, module: ViewerModule) {
  const sources = new Map<string, { sql: string; hash: string; requires: string[] }>();
  for (const name of (await readdir(module.directory))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(new URL(name, module.directory), 'utf8');
    const requires = [...sql.matchAll(/^-- requires-table: ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)$/gm)].map(
      (m) => m[1]!,
    );
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex'), requires });
  }
  const db = await pool.connect();
  const applied: string[] = [];
  const waiting: string[] = [];
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
    if (!done.some((name) => name.startsWith('0002_')))
      throw new Error(
        `The customer real-use modules are not installed, so ${module.label.toLowerCase()} was not installed. Run the real-use install first.`,
      );
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${module.schema}`);
    await db.query(
      `REVOKE ALL ON SCHEMA ${module.schema} FROM PUBLIC,corridra_runtime,corridra_auth`,
    );
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${module.schema}.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const recorded = await db.query<{ name: string; sha256: string }>(
      `SELECT name,sha256 FROM ${module.schema}.applied ORDER BY name`,
    );
    for (const row of recorded.rows)
      if (sources.get(row.name)?.hash !== row.sha256)
        throw new Error(`${module.label} migration history mismatch`);
    for (const [name, source] of sources) {
      if (recorded.rows.some((row) => row.name === name)) continue;
      let ready = true;
      for (const table of source.requires) {
        const present = await db.query<{ present: boolean }>(
          'SELECT to_regclass($1) IS NOT NULL AS present',
          [table],
        );
        if (!present.rows[0]?.present) ready = false;
      }
      if (!ready) {
        waiting.push(name);
        continue;
      }
      // A file that waited may not land behind a later file already recorded (for example a rollback copy): the order the
      // files were reviewed in would no longer hold. Refuse and name both; a reviewed change decides what happens next.
      const later = recorded.rows.find((row) => row.name > name);
      if (later)
        throw new Error(
          `${module.label}: ${name} waited for ${source.requires.join(', ')}, but the later file ${later.name} is already recorded. Review the order before installing.`,
        );
      await db.query(source.sql);
      await db.query(`INSERT INTO ${module.schema}.applied(name,sha256) VALUES($1,$2)`, [
        name,
        source.hash,
      ]);
      applied.push(name);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
  return { applied, waiting };
}
