import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DatabasePool } from '@corridra/db';

// Offline schema-owner operation only. No request handler imports this module.
// The existing destination supplies explicit staff authority, never customer input.
export async function configureCustomerRealUse(pool: DatabasePool, input: unknown) {
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
      (SELECT relowner FROM pg_class WHERE oid='customer_private.real_use_configuration'::regclass),
      'MEMBER') AS approved`);
    if (!authority.rows[0]?.approved)
      throw new Error('Offline customer schema-owner authority is required');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('corridra:real-use-configuration'))");
    let configuration = (
      await db.query<{
        intake_tenant_id: string;
        executor_id: string;
      }>('SELECT intake_tenant_id,executor_id FROM customer_private.real_use_configuration')
    ).rows[0];
    if (!configuration) {
      if (!value.enabled) throw new Error('Real-use configuration has not been initialized');
      // Customer events and public intake have independently pinned service identities.
      // Validate both authorities without repinning or requiring them to be identical.
      const source = (
        await db.query<{
          issuer: string;
          executor_id: string;
          tenant_id: string;
          owner_id: string;
        }>(`SELECT c.issuer,c.executor_id,d.tenant_id,d.owner_id
        FROM customer_private.configuration c JOIN app.intake_destination d ON d.singleton
        JOIN identity.principal executor ON executor.id=c.executor_id
        JOIN identity.principal intake_service ON intake_service.id=d.service_id
        JOIN identity.principal owner ON owner.id=d.owner_id
        JOIN app.membership m ON m.tenant_id=d.tenant_id AND m.user_id=d.owner_id
        WHERE c.singleton AND d.singleton AND d.enabled AND executor.kind='service'
        AND intake_service.kind='service' AND intake_service.disabled_at IS NULL
        AND executor.disabled_at IS NULL AND owner.disabled_at IS NULL
        AND m.revoked_at IS NULL AND m.role IN ('owner','admin')
        AND 'synthetic_validation'=ANY(m.allowed_purposes)
        FOR SHARE OF c,d,m,executor,intake_service,owner`)
      ).rows[0];
      if (!source)
        throw new Error('Pinned issuer, active executor and existing intake owner are required');
      await db.query(
        `SELECT set_config('corridra.bootstrap_actor',$1,true),
        set_config('corridra.correlation_id',$2,true),set_config('corridra.causation_id',$3,true)`,
        [source.executor_id, randomUUID(), randomUUID()],
      );
      const tenantId = randomUUID();
      await db.query(
        "INSERT INTO app.tenant(id,name,synthetic) VALUES($1,'Corridra request operations',false)",
        [tenantId],
      );
      // Preserve the existing role, classification and country limits. Only active
      // staff with the previous intake purpose receive the corresponding new scope.
      await db.query(
        `INSERT INTO app.membership(tenant_id,user_id,role,allowed_purposes,allowed_classifications,allowed_countries)
        SELECT $1,m.user_id,m.role,ARRAY['commercial_qualification'],m.allowed_classifications,m.allowed_countries
        FROM app.membership m JOIN identity.principal p ON p.id=m.user_id
        WHERE m.tenant_id=$2 AND m.revoked_at IS NULL AND p.disabled_at IS NULL
        AND 'synthetic_validation'=ANY(m.allowed_purposes)`,
        [tenantId, source.tenant_id],
      );
      await db.query(
        `INSERT INTO customer_private.real_use_configuration
        (issuer,executor_id,intake_tenant_id,owner_id,notice_version,enabled)
        VALUES($1,$2,$3,$4,'real-intake-2026-10-21-v1',true)`,
        [source.issuer, source.executor_id, tenantId, source.owner_id],
      );
      await db.query(
        `INSERT INTO app.config_version(tenant_id,key,version,value,effective_from,purpose,created_by)
        VALUES($1,'evidence.scan_bypass',1,$2::jsonb,clock_timestamp(),'commercial_qualification',$3)`,
        [tenantId, JSON.stringify({ enabled: true, reason: value.reason }), source.owner_id],
      );
      configuration = { intake_tenant_id: tenantId, executor_id: source.executor_id };
    }
    const latest = (
      await db.query<{ version: number; enabled: boolean }>(
        'SELECT version,enabled FROM customer_private.real_use_admission_control ORDER BY version DESC LIMIT 1',
      )
    ).rows[0];
    if (!latest || latest.enabled !== value.enabled)
      await db.query(
        `INSERT INTO customer_private.real_use_admission_control(version,enabled,executor_id,reason)
        VALUES($1,$2,$3,$4)`,
        [(latest?.version ?? 0) + 1, value.enabled, configuration.executor_id, value.reason],
      );
    await db.query('COMMIT');
    return { enabled: value.enabled, changed: !latest || latest.enabled !== value.enabled };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
