import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// It opens or pauses the `module` control of the supply sources module (ADR-082 section 12) and nothing else: in slices S2
// to S7 the control name is not an input, so no installer value can open partner kinds, the platform kind, connectors,
// Mode B release, personal data or staff file import. Pausing keeps every record and every read; only new commands refuse.
export async function configureSupplySources(pool: DatabasePool, input: unknown) {
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
      "SELECT to_regclass('app.supply_source_control') IS NOT NULL AS present",
    );
    if (!installed.rows[0]?.present)
      throw new Error(
        'Supply sources are not installed. Run the explicit supply_sources_install first.',
      );
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='app.supply_source_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved) throw new Error('Offline schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:supply-source-configuration'))",
    );
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        "SELECT version,enabled FROM app.supply_source_control WHERE control='module' ORDER BY version DESC LIMIT 1",
      )
    ).rows[0];
    const changed = (latest?.enabled ?? false) !== value.enabled;
    if (changed)
      await db.query(
        "INSERT INTO app.supply_source_control(control,version,enabled,reason) VALUES('module',$1,$2,$3)",
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
