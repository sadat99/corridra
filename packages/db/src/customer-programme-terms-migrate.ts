import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerProgrammeEconomics } from './customer-programme-economics-migrate';
import { migrateCustomerProgrammeCoordination } from './customer-programme-coordination-migrate';
import { migrateCustomerMemberRoles } from './customer-member-role-migrate';
// Explicit optional programme terms, eligibility and places authority. It reads the economics ledger (fees),
// the coordination task board and capacity, the organisation profile and the member roles, so those are
// installed first. Accepted base lifecycles are unchanged.
export async function migrateCustomerProgrammeTerms(pool: DatabasePool) {
  await migrateCustomerProgrammeEconomics(pool);
  await migrateCustomerProgrammeCoordination(pool);
  await migrateCustomerMemberRoles(pool);
  const name = '0001_programme_terms_eligibility_and_places.sql';
  const sql = await readFile(
    new URL('../customer-programme-terms-migrations/' + name, import.meta.url),
    'utf8',
  );
  const hash = createHash('sha256').update(sql).digest('hex');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_programme_terms_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_programme_terms_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_programme_terms_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const previous = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_programme_terms_migrations.applied ORDER BY name',
    );
    if (previous.rows.some((row) => row.name !== name || row.sha256 !== hash))
      throw new Error('Customer programme-terms migration history mismatch');
    if (previous.rowCount === 0) {
      await db.query(sql);
      await db.query(
        'INSERT INTO customer_programme_terms_migrations.applied(name,sha256) VALUES($1,$2)',
        [name, hash],
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
