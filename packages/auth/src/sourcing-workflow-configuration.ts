import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// ADR-083 slice S1. It opens or pauses the sourcing workflow control (one switch). While it is closed or paused a route pack
// with a sourcing profile is refused. Pausing keeps every pack version and every record; only new writes are refused.
export async function configureSourcingWorkflow(pool: DatabasePool, input: unknown) {
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
      "SELECT to_regclass('app.sourcing_workflow_control') IS NOT NULL AS present",
    );
    if (!installed.rows[0]?.present)
      throw new Error(
        'The sourcing workflow is not installed. Run the explicit sourcing_workflow_install first.',
      );
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='app.sourcing_workflow_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved) throw new Error('Offline schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:sourcing-workflow-configuration'))",
    );
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        'SELECT version,enabled FROM app.sourcing_workflow_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    const changed = (latest?.enabled ?? false) !== value.enabled;
    if (changed)
      await db.query(
        'INSERT INTO app.sourcing_workflow_control(version,enabled,reason) VALUES($1,$2,$3)',
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
