import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';
import { customerIssuer } from './customer-workspaces';

// Offline schema-owner procedure. Never import into a request handler, and never
// derive admission from customer email, staff email or an untrusted request.
export async function admitSyntheticCustomer(pool: DatabasePool, input: unknown) {
  const value = z
    .object({
      issuer: customerIssuer,
      subject: z.string().min(1).max(200),
      executorId: z.uuid(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const {
      rows: [authority],
    } = await db.query(`SELECT
      pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='customer_private.configuration'::regclass),'MEMBER')
      AND pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='customer_private.principal'::regclass),'MEMBER') AS approved`);
    if (!authority?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:customer-admission'))");
    if (
      !(
        await db.query(
          "SELECT 1 FROM identity.principal WHERE id=$1 AND kind='service' AND disabled_at IS NULL",
          [value.executorId],
        )
      ).rowCount
    )
      throw new Error('An active service executor is required');
    const {
      rows: [configuration],
    } = await db.query('SELECT issuer,executor_id FROM customer_private.configuration');
    if (
      configuration &&
      (configuration.issuer !== value.issuer || configuration.executor_id !== value.executorId)
    )
      throw new Error(
        'Customer issuer/executor is pinned; review a forward migration to change it',
      );
    if (!configuration)
      await db.query(
        'INSERT INTO customer_private.configuration(issuer,executor_id) VALUES($1,$2)',
        [value.issuer, value.executorId],
      );
    const {
      rows: [principal],
    } = await db.query(
      `INSERT INTO customer_private.principal(issuer,subject,admission_reason)
      VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO NOTHING RETURNING id,disabled_at`,
      [value.issuer, value.subject, value.reason],
    );
    const admitted =
      principal ??
      (
        await db.query(
          'SELECT id,disabled_at FROM customer_private.principal WHERE issuer=$1 AND subject=$2',
          [value.issuer, value.subject],
        )
      ).rows[0];
    await db.query('COMMIT');
    return { id: admitted.id as string, active: admitted.disabled_at === null };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
