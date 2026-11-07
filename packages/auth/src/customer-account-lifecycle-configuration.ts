import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// It opens or closes account closing and erasure requests together (one switch). A closed control keeps every record.
// Undoing a closure never needs it open, and pausing never reopens a closed account.
export async function configureAccountLifecycle(pool: DatabasePool, input: unknown) {
  const value = z
    .object({
      enabled: z.boolean(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const installed = await db.query<{ present: boolean }>(
      "SELECT to_regclass('customer_private.account_lifecycle_control') IS NOT NULL AS present",
    );
    if (!installed.rows[0]?.present)
      throw new Error(
        'Account lifecycle is not installed. Run the explicit account lifecycle install first.',
      );
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='customer_private.account_lifecycle_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:account-lifecycle-configuration'))",
    );
    const configuration = (
      await db.query<{ executor_id: string }>(
        'SELECT executor_id FROM customer_private.real_use_configuration',
      )
    ).rows[0];
    if (!configuration) throw new Error('Real-use configuration has not been initialized');
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        'SELECT version,enabled FROM customer_private.account_lifecycle_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    if ((latest?.enabled ?? false) !== value.enabled)
      await db.query(
        `INSERT INTO customer_private.account_lifecycle_control(version,enabled,executor_id,reason)
        VALUES($1,$2,$3,$4)`,
        [(latest?.version ?? 0) + 1, value.enabled, configuration.executor_id, value.reason],
      );
    await db.query('COMMIT');
    return { enabled: value.enabled, changed: (latest?.enabled ?? false) !== value.enabled };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
