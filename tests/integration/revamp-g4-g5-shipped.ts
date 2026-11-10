import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from '../../packages/db/src/index';

// The CRUD G4 and G5 migration files exactly as they were installed in production (merge f62e093d), kept as fixtures so
// the upgrade tests can build a database the old way and then run the current installers over it. Never edit these.
const root = new URL('./fixtures/revamp-g4-g5-shipped/', import.meta.url);

export async function shippedFiles(module: 'workspace' | 'account') {
  const directory = new URL(`${module}/`, root);
  const files: { name: string; sql: string; hash: string }[] = [];
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    files.push({ name, sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  return files;
}

// Installs one module the way the installer did: schema, registry, then each file with its recorded hash.
async function installShipped(pool: DatabasePool, module: 'workspace' | 'account') {
  const schema = `customer_${module}_lifecycle_migrations`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC,corridra_runtime,corridra_auth`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${schema}.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  for (const file of await shippedFiles(module)) {
    await pool.query(file.sql);
    await pool.query(`INSERT INTO ${schema}.applied(name,sha256) VALUES($1,$2)`, [
      file.name,
      file.hash,
    ]);
  }
}

export async function installShippedG4G5(pool: DatabasePool) {
  await installShipped(pool, 'workspace');
  await installShipped(pool, 'account');
}
