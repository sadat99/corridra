import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline owner operation for the simulated payment provider (ADR-065). The control starts closed. A change is one
// immutable row with a reason. The refund window is a made-up policy (madeup); the default is 14 days.
export async function configureSimulatedPayments(pool: DatabasePool, input: unknown) {
  const value = z
    .object({
      // Open or close the control. Omit to leave it as it is.
      enabled: z.boolean().optional(),
      // The made-up refund window in days. Omit to leave it as it is (default 14).
      refundWindowDays: z.number().int().min(1).max(90).optional(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='customer_private.simulated_payments_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:simulated-payments-configuration'))",
    );
    const configuration = (
      await db.query<{ executor_id: string }>(
        'SELECT executor_id FROM customer_private.real_use_configuration',
      )
    ).rows[0];
    if (!configuration) throw new Error('Real-use configuration has not been initialized');
    const latest = (
      await db.query<{ version: number; enabled: boolean; refund_window_days: number }>(
        'SELECT version,enabled,refund_window_days FROM customer_private.simulated_payments_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    const enabled = value.enabled ?? latest?.enabled ?? false;
    const windowDays = value.refundWindowDays ?? latest?.refund_window_days ?? 14;
    const changed =
      (value.enabled !== undefined || value.refundWindowDays !== undefined) &&
      ((latest?.enabled ?? false) !== enabled || (latest?.refund_window_days ?? 14) !== windowDays);
    if (changed)
      await db.query(
        `INSERT INTO customer_private.simulated_payments_control(version,enabled,refund_window_days,executor_id,reason)
        VALUES($1,$2,$3,$4,$5)`,
        [(latest?.version ?? 0) + 1, enabled, windowDays, configuration.executor_id, value.reason],
      );
    await db.query('COMMIT');
    return { enabled, refundWindowDays: windowDays, changed };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
