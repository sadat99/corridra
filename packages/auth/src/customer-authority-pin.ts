import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';
import { customerIssuer } from './customer-workspaces';

// Offline schema-owner procedure, never imported by a request handler. Pins the one issuer the customer
// modules accept and the service principal that is recorded as the executor of customer events. It is
// idempotent for identical values and refuses to change an existing pin.
export async function pinCustomerAuthority(pool: DatabasePool, input: unknown) {
  const value = z.object({ issuer: customerIssuer, executorId: z.uuid() }).strict().parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const {
      rows: [authority],
    } = await db.query(`SELECT
      pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid='customer_private.configuration'::regclass),'MEMBER') AS approved`);
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
      rows: [existing],
    } = await db.query('SELECT issuer,executor_id FROM customer_private.configuration');
    let pinned: 'created' | 'unchanged';
    if (existing) {
      if (existing.issuer !== value.issuer || existing.executor_id !== value.executorId)
        throw new Error(
          'Customer issuer/executor is pinned; review a forward migration to change it',
        );
      pinned = 'unchanged';
    } else {
      await db.query(
        'INSERT INTO customer_private.configuration(issuer,executor_id) VALUES($1,$2)',
        [value.issuer, value.executorId],
      );
      pinned = 'created';
    }
    await db.query('COMMIT');
    return { pinned };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
