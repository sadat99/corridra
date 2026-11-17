import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';

// ADR-087 U2. Explicit optional installation, reached only through field_modules_action=viewer_reply_metadata: staff viewers
// read reply and answer metadata only (two read policy pairs gain the viewer clause, and two typed meta reads are added). It
// refuses unless the customer real-use modules that hold the real read policies are installed (it never installs them), and
// each SQL file refuses unless every policy it replaces is exactly the one it was written against. A file whose header names a
// table with "-- requires-table:" is applied only where that table exists, and is otherwise left unrecorded so a later run
// applies it: 0002 waits for the recipient response revision module, whose install re-runs this migrator. Only the .sql files
// directly in the folder are read; the rollback folder is never applied. Not memoised on purpose: the response revision install
// calls it again in the same run. No runtime request receives this owner connection.
export async function migrateViewerReplyMetadata(pool: DatabasePool) {
  return migrateViewerModule(pool, {
    directory: new URL('../viewer-reply-metadata-migrations/', import.meta.url),
    schema: 'viewer_reply_metadata_migrations',
    label: 'Viewer reply metadata',
  });
}

export type ViewerModule = { directory: URL; schema: string; label: string };

// Shared by the two ADR-087 viewer modules (U2 and U3). Same registry shape and history check as every optional module.
export async function migrateViewerModule(pool: DatabasePool, module: ViewerModule) {
  const sources = new Map<string, { sql: string; hash: string; requires: string[] }>();
  for (const name of (await readdir(module.directory))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(new URL(name, module.directory), 'utf8');
    const requires = [...sql.matchAll(/^-- requires-table: ([a-z_]+\.[a-z_]+)$/gm)].map(
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

// True when this module's registry exists, so a later install that it waits for (response revision) can bring it current.
export async function viewerReplyMetadataInstalled(pool: DatabasePool) {
  const r = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('viewer_reply_metadata_migrations.applied') IS NOT NULL AS present",
  );
  return Boolean(r.rows[0]?.present);
}
