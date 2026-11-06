import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// It opens or closes withdrawing a request. A closed control keeps every record, and restoring a
// withdrawn request never needs it open, so a paused control can never trap a withdrawal.
export async function configureRequestWithdrawal(pool: DatabasePool, input: unknown) {
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
      (SELECT relowner FROM pg_class WHERE oid='customer_private.request_withdrawal_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:request-withdrawal-configuration'))",
    );
    const configuration = (
      await db.query<{ executor_id: string }>(
        'SELECT executor_id FROM customer_private.real_use_configuration',
      )
    ).rows[0];
    if (!configuration) throw new Error('Real-use configuration has not been initialized');
    // Withdrawal promises that no email or notice is sent about a withdrawn request. That is kept by the withdrawal
    // files of the two mail modules, so opening is refused while either module is installed without its file.
    // A module that is not installed needs nothing; pausing is never refused.
    if (value.enabled)
      for (const [schema, first, upgrade] of [
        [
          'customer_mission_mail_migrations',
          '0001_mission_mail.sql',
          '0003_withdrawn_requests.sql',
        ],
        [
          'customer_notification_migrations',
          '0001_notifications.sql',
          '0005_withdrawn_requests.sql',
        ],
      ] as const) {
        const registry = await db.query<{ present: boolean }>(
          'SELECT to_regclass($1) IS NOT NULL AS present',
          [`${schema}.applied`],
        );
        if (!registry.rows[0]?.present) continue;
        const names = (
          await db.query<{ name: string }>(`SELECT name FROM ${schema}.applied`)
        ).rows.map((row) => row.name);
        if (names.includes(first) && !names.includes(upgrade))
          throw new Error(
            'Upgrade the installed mail modules before opening request withdrawal (' +
              schema +
              ' is missing ' +
              upgrade +
              ')',
          );
      }
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        'SELECT version,enabled FROM customer_private.request_withdrawal_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    if ((latest?.enabled ?? false) !== value.enabled)
      await db.query(
        `INSERT INTO customer_private.request_withdrawal_control(version,enabled,executor_id,reason)
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
