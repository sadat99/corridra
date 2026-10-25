import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// It opens or closes the database side of reply review. The application switch is separate and both
// must be on before the team can record a review. A closed control keeps every record.
export async function configureReplyReview(pool: DatabasePool, input: unknown) {
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
      (SELECT relowner FROM pg_class WHERE oid='app.reply_review_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved) throw new Error('Offline schema-owner authority is required');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:reply-review-configuration'))");
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        'SELECT version,enabled FROM app.reply_review_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    const changed = (latest?.enabled ?? false) !== value.enabled;
    if (changed)
      await db.query(
        'INSERT INTO app.reply_review_control(version,enabled,reason) VALUES($1,$2,$3)',
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
