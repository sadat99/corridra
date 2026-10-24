import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerBillingReal } from './customer-billing-real-migrate';
import { migrateCustomerInvoicing } from './customer-invoicing-migrate';

// Explicit optional installation (ADR-064, billing stage 2). It serves no real workspace by itself: the control it creates
// starts closed. Sample invoicing behaves as before. No runtime request receives this owner connection.
export async function migrateCustomerInvoicingReal(pool: DatabasePool) {
  await migrateCustomerInvoicing(pool);
  await migrateCustomerBillingReal(pool);
  const directory = new URL('../customer-invoicing-real-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_invoicing_real_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_invoicing_real_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_invoicing_real_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_invoicing_real_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Real invoicing migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_invoicing_real_migrations.applied(name,sha256) VALUES($1,$2)',
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
