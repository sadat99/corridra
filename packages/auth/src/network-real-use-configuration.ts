import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Protected offline owner procedure; the web application never imports an owner pool.
export async function configureNetworkRealUse(pool: DatabasePool, input: unknown) {
  const value = z
    .object({ enabled: z.boolean(), reason: z.string().trim().min(10).max(500) })
    .strict()
    .parse(input);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const authority = await db.query(
      "SELECT coalesce(pg_has_role(current_user,(SELECT relowner FROM pg_class WHERE oid=to_regclass('network_real_use_migrations.applied')),'MEMBER'),false) AS approved",
    );
    if (!authority.rows[0]?.approved)
      throw new Error('Offline installed Network schema-owner authority is required');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('corridra:network-real-use-configuration'))",
    );
    const source = (
      await db.query<{
        intake_tenant_id: string;
        owner_id: string;
        executor_id: string;
      }>(`SELECT c.intake_tenant_id,c.owner_id,c.executor_id FROM customer_private.real_use_configuration c
      JOIN app.tenant t ON t.id=c.intake_tenant_id AND NOT t.synthetic
      JOIN identity.principal executor ON executor.id=c.executor_id AND executor.kind='service' AND executor.disabled_at IS NULL
      JOIN identity.principal owner ON owner.id=c.owner_id AND owner.disabled_at IS NULL
      JOIN app.membership m ON m.tenant_id=t.id AND m.user_id=owner.id AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
      WHERE c.enabled AND 'commercial_qualification'=ANY(m.allowed_purposes) AND owner.operating_country=ANY(m.allowed_countries)
      FOR SHARE OF c,t,executor,owner,m`)
    ).rows[0];
    if (!source)
      throw new Error('Enabled real scope and active original owner/executor are required');
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        "SELECT version,coalesce((value->>'enabled')::boolean,false) AS enabled FROM app.config_version WHERE tenant_id=$1 AND key='network.enabled' ORDER BY version DESC LIMIT 1",
        [source.intake_tenant_id],
      )
    ).rows[0];
    if (!latest || latest.enabled !== value.enabled) {
      await db.query(
        "SELECT set_config('corridra.bootstrap_actor',$1,true),set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)",
        [source.executor_id, randomUUID(), randomUUID()],
      );
      await db.query(
        `INSERT INTO app.config_version(tenant_id,key,version,value,effective_from,purpose,created_by)
        VALUES($1,'network.enabled',$2,$3::jsonb,clock_timestamp(),'commercial_qualification',$4)`,
        [
          source.intake_tenant_id,
          (latest?.version ?? 0) + 1,
          JSON.stringify(value),
          source.owner_id,
        ],
      );
    }
    await db.query('COMMIT');
    return { enabled: value.enabled, changed: !latest || latest.enabled !== value.enabled };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
