import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerInvoicingReal } from './customer-invoicing-real-migrate';

// Explicit optional installation (ADR-065, billing stage 3). It serves no real workspace by itself: the control it creates
// starts closed, and nothing it records is real money. No runtime request receives this owner connection.
export async function migrateCustomerPaymentsSimulated(pool: DatabasePool) {
  await migrateCustomerInvoicingReal(pool);
  const directory = new URL('../customer-payments-simulated-migrations/', import.meta.url);
  const sources = new Map<string, { sql: string; hash: string }>();
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    sources.set(name, { sql, hash: createHash('sha256').update(sql).digest('hex') });
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_payments_simulated_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_payments_simulated_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_payments_simulated_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const applied = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_payments_simulated_migrations.applied ORDER BY name',
    );
    for (const row of applied.rows)
      if (!sources.has(row.name) || sources.get(row.name)!.hash !== row.sha256)
        throw new Error('Simulated payments migration history mismatch');
    for (const [name, source] of sources) {
      if (applied.rows.some((row) => row.name === name)) continue;
      await db.query(source.sql);
      await db.query(
        'INSERT INTO customer_payments_simulated_migrations.applied(name,sha256) VALUES($1,$2)',
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
