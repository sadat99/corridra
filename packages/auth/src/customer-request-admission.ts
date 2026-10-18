import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner procedure, never imported into a handler. Workspace
// admission alone does not authorize requests; re-admission cannot undo disable.
export async function admitSyntheticCustomerRequests(pool: DatabasePool, input: unknown) {
  const value = z
    .object({ principalId: z.uuid(), reason: z.string().trim().min(10).max(500) })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const {
      rows: [authority],
    } = await db.query(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='customer_private.request_admission'::regclass),'MEMBER') AS approved`);
    if (!authority?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    const principal = await db.query(
      `SELECT p.id FROM customer_private.principal p
      JOIN customer_private.configuration c ON c.issuer=p.issuer AND c.synthetic
      WHERE p.id=$1 AND p.disabled_at IS NULL FOR SHARE OF p`,
      [value.principalId],
    );
    if (!principal.rowCount) throw new Error('An active admitted synthetic customer is required');
    await db.query(
      `INSERT INTO customer_private.request_admission(principal_id,reason)
      VALUES($1,$2) ON CONFLICT(principal_id) DO NOTHING`,
      [value.principalId, value.reason],
    );
    const {
      rows: [row],
    } = await db.query(
      'SELECT disabled_at FROM customer_private.request_admission WHERE principal_id=$1',
      [value.principalId],
    );
    await db.query('COMMIT');
    return { id: value.principalId, active: row.disabled_at === null };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}

// Serialize an independent resource revocation against in-flight private reads.
export async function revokeSyntheticCustomerRequest(pool: DatabasePool, input: unknown) {
  const value = z
    .object({ requestId: z.uuid(), reason: z.string().trim().min(10).max(500) })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const {
      rows: [authority],
    } = await db.query(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='customer_private.request_revocation'::regclass),'MEMBER') AS approved`);
    if (!authority?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    const request = await db.query(
      'SELECT id FROM customer_private.owned_request WHERE id=$1 FOR UPDATE',
      [value.requestId],
    );
    if (!request.rowCount) throw new Error('Private request unavailable');
    await db.query(
      `INSERT INTO customer_private.request_revocation(request_id,reason) VALUES($1,$2)
      ON CONFLICT(request_id) DO NOTHING`,
      [value.requestId, value.reason],
    );
    await db.query('COMMIT');
    return { id: value.requestId, revoked: true };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
