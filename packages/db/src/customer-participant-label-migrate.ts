import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateCustomerProgrammeProjections } from './customer-programme-projection-migrate';
// Explicit optional participant label correction (CRUD gap G7, module 2). It replaces readers of the participant label that the
// real-use state and the programme lifecycle module already replaced, so both must already be installed (this installer installs neither). Accepted base lifecycles are unchanged: no business row is rewritten.
export async function migrateCustomerParticipantLabels(pool: DatabasePool) {
  const prerequisites = await pool.query<{ real: boolean; lifecycle: boolean }>(
    "SELECT to_regclass('customer_real_use_migrations.applied') IS NOT NULL AS real,to_regclass('customer_programme_lifecycle_migrations.applied') IS NOT NULL AS lifecycle",
  );
  if (!prerequisites.rows[0]?.real || !prerequisites.rows[0]?.lifecycle)
    throw new Error(
      'Install the real-use customer modules and the programme lifecycle before the participant labels',
    );
  // The programme projections show a participant's label, so that module is installed first and its reader is replaced too.
  await migrateCustomerProgrammeProjections(pool);
  const name = '0001_participant_label.sql';
  const sql = await readFile(
    new URL('../customer-participant-label-migrations/' + name, import.meta.url),
    'utf8',
  );
  const hash = createHash('sha256').update(sql).digest('hex');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_participant_label_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_participant_label_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_participant_label_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const previous = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_participant_label_migrations.applied ORDER BY name',
    );
    if (previous.rows.some((row) => row.name !== name || row.sha256 !== hash))
      throw new Error('Customer participant-label migration history mismatch');
    if (previous.rowCount === 0) {
      await db.query(sql);
      await db.query(
        'INSERT INTO customer_participant_label_migrations.applied(name,sha256) VALUES($1,$2)',
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
