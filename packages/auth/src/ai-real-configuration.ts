import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// ADR-091. It opens or pauses the one control that lets real workspaces use AI assistance (app.ai_real_control) and nothing
// else. Opening it starts no run and calls no provider: each workspace owner still switches ai.enabled on, the deployment
// still needs CORRIDRA_AI_ENABLED, a provider key and its processing locations, and every run still needs a reviewed model
// policy, source rights and a route that names the policy. Pausing keeps every record and every read; only new runs,
// attempts, results, completions and reviews in real workspaces refuse. Sample workspaces are never affected.
export async function configureAiRealRuns(pool: DatabasePool, input: unknown) {
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
      "SELECT to_regclass('app.ai_real_control') IS NOT NULL AND to_regprocedure('app.ai_real_runs_open()') IS NOT NULL AS present",
    );
    if (!installed.rows[0]?.present)
      throw new Error(
        'AI for real workspaces is not installed. Run the explicit ai_real_install first.',
      );
    const authority = await db.query<{ approved: boolean }>(`SELECT pg_has_role(current_user,
      (SELECT relowner FROM pg_class WHERE oid='app.ai_real_control'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved) throw new Error('Offline schema-owner authority is required');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:ai-real-configuration'))");
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        'SELECT version,enabled FROM app.ai_real_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    const changed = (latest?.enabled ?? false) !== value.enabled;
    if (changed)
      await db.query('INSERT INTO app.ai_real_control(version,enabled,reason) VALUES($1,$2,$3)', [
        (latest?.version ?? 0) + 1,
        value.enabled,
        value.reason,
      ]);
    await db.query('COMMIT');
    return { enabled: value.enabled, changed };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
