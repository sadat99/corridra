import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// It opens or closes answer correction through a recipient's private link (CRUD gap G7, module 3). It starts closed. A closed
// control keeps every record and every earlier correction; it only stops new ones.
export async function configureRecipientRevision(pool: DatabasePool, input: unknown) {
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
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='app.recipient_revision_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved) throw new Error('Offline schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:recipient-revision-configuration'))",
    );
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        'SELECT version,enabled FROM app.recipient_revision_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    const changed = (latest?.enabled ?? false) !== value.enabled;
    if (changed)
      await db.query(
        'INSERT INTO app.recipient_revision_control(version,enabled,reason) VALUES($1,$2,$3)',
        [(latest?.version ?? 0) + 1, value.enabled, value.reason],
      );
    await db.query('COMMIT');
    return { enabled: value.enabled, changed };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
