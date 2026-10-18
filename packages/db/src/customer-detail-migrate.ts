import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerAuthority } from './customer-migrate';
// A separately opted-in disclosure module. The accepted three-module request
// authority installer and its existing callers keep their original lifecycle.
export async function migrateCustomerRequestDetails(pool: DatabasePool) {
  await migrateCustomerAuthority(pool);
  const name = '0001_original_request_details.sql';
  const sql = await readFile(
    new URL('../customer-detail-migrations/' + name, import.meta.url),
    'utf8',
  );
  const hash = createHash('sha256').update(sql).digest('hex');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_detail_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_detail_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_detail_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const previous = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_detail_migrations.applied ORDER BY name',
    );
    if (previous.rows.some((row) => row.name !== name || row.sha256 !== hash))
      throw new Error('Customer detail migration history mismatch');
    if (previous.rowCount === 0) {
      await db.query(sql);
      await db.query('INSERT INTO customer_detail_migrations.applied(name,sha256) VALUES($1,$2)', [
        name,
        hash,
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
