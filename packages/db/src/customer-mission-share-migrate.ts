import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { DatabasePool } from './index';
import { migrateOnce } from './migration-run';
import { migrateCustomerParticipants } from './customer-participant-migrate';
import { migrateCustomerRequestDetails } from './customer-detail-migrate';
// Explicit optional objective-sharing authority; accepted base lifecycles unchanged.
export function migrateCustomerMissionShares(pool: DatabasePool) {
  return migrateOnce(pool, 'migrateCustomerMissionShares', () =>
    migrateCustomerMissionSharesRun(pool),
  );
}

const names = [
  '0001_participant_mission_summaries.sql',
  '0002_programme_shared_objective_count.sql',
];

async function migrateCustomerMissionSharesRun(pool: DatabasePool) {
  await migrateCustomerParticipants(pool);
  await migrateCustomerRequestDetails(pool);
  const files = await Promise.all(
    names.map(async (name) => {
      const sql = await readFile(
        new URL('../customer-mission-share-migrations/' + name, import.meta.url),
        'utf8',
      );
      return { name, sql, hash: createHash('sha256').update(sql).digest('hex') };
    }),
  );
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:migrations'))");
    await db.query('CREATE SCHEMA IF NOT EXISTS customer_mission_share_migrations');
    await db.query(
      'REVOKE ALL ON SCHEMA customer_mission_share_migrations FROM PUBLIC,corridra_runtime,corridra_auth',
    );
    await db.query(
      'CREATE TABLE IF NOT EXISTS customer_mission_share_migrations.applied(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const previous = await db.query<{ name: string; sha256: string }>(
      'SELECT name,sha256 FROM customer_mission_share_migrations.applied ORDER BY name',
    );
    // The history must be a prefix of the ordered list, each file with its recorded hash.
    if (
      previous.rows.length > files.length ||
      previous.rows.some((row, i) => row.name !== files[i]!.name || row.sha256 !== files[i]!.hash)
    )
      throw new Error('Customer mission-share migration history mismatch');
    for (const file of files.slice(previous.rows.length)) {
      await db.query(file.sql);
      await db.query(
        'INSERT INTO customer_mission_share_migrations.applied(name,sha256) VALUES($1,$2)',
        [file.name, file.hash],
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
