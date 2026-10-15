import { z } from 'zod';
import { DomainError, role } from '@corridra/domain';
import { withTenant, sessionHash, type Pool, type RequestContext } from '@corridra/db';
export class AccessService {
  constructor(
    private pool: Pool,
    private identityPool?: Pool,
  ) {}
  async tenants(token: string) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.purpose','synthetic_validation',true)",
        [sessionHash(token)],
      );
      const r = await db.query('SELECT * FROM app.my_tenants()');
      await db.query('COMMIT');
      return r.rows as { id: string; name: string; role: string }[];
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }
  members(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'audit.read', async (t) => {
      const members = (
        await t.db.query(
          'SELECT user_id,role,revoked_at,allowed_purposes,allowed_classifications,allowed_countries FROM app.membership WHERE tenant_id=$1 ORDER BY created_at',
          [t.tenantId],
        )
      ).rows;
      if (!this.identityPool || members.length === 0) return members;
      // Resolve names only after current tenant authorization, and only for its members.
      const profiles = await this.identityPool.query(
        'SELECT p.id,u.name FROM identity.principal p JOIN identity."user" u ON u.id=p.identity_id WHERE p.id=ANY($1::uuid[])',
        [members.map((member) => member.user_id)],
      );
      const names = new Map(profiles.rows.map((profile) => [profile.id, profile.name]));
      return members.map((member) => ({ ...member, name: names.get(member.user_id) ?? null }));
    });
  }
  changeMember(ctx: RequestContext, input: unknown) {
    const v = z.object({ userId: z.uuid(), role, revoked: z.boolean() }).parse(input);
    return withTenant(this.pool, ctx, 'members.manage', async (t) => {
      await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [t.tenantId]);
      const old = await t.db.query(
        'SELECT role FROM app.membership WHERE tenant_id=$1 AND user_id=$2',
        [t.tenantId, v.userId],
      );
      if (!old.rowCount) throw new DomainError('Membership unavailable', 404);
      if (old.rows[0].role === 'owner' && (v.role !== 'owner' || v.revoked)) {
        const count = await t.db.query(
          "SELECT count(*)::int AS count FROM app.membership WHERE tenant_id=$1 AND role='owner' AND revoked_at IS NULL",
          [t.tenantId],
        );
        if (count.rows[0].count <= 1)
          throw new DomainError('The tenant must retain an active owner', 409);
      }
      await t.db.query(
        'UPDATE app.membership SET role=$3,revoked_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE tenant_id=$1 AND user_id=$2',
        [t.tenantId, v.userId, v.role, v.revoked],
      );
      return { updated: true };
    });
  }
  appendConfig(ctx: RequestContext, input: unknown) {
    const v = z
      .object({
        key: z.enum([
          'evidence.uploads',
          'evidence.verification',
          'evidence.scan_bypass',
          'research.ingestion',
          'research.resolution',
          'communications.introductions',
          'communications.dispatch',
          'opportunities.commands',
          'ai.enabled',
          'network.enabled',
        ]),
        enabled: z.boolean(),
      })
      .parse(input);
    return withTenant(this.pool, ctx, 'config.manage', async (t) => {
      await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `${t.tenantId}:${v.key}`,
      ]);
      const r = await t.db.query(
        `INSERT INTO app.config_version(tenant_id,key,version,value,effective_from,purpose,created_by) SELECT $1,$2,COALESCE(max(version),0)+1,$3::jsonb,now(),$4,$5 FROM app.config_version WHERE tenant_id=$1 AND key=$2 RETURNING id,version`,
        [t.tenantId, v.key, JSON.stringify({ enabled: v.enabled }), t.purpose, t.actorId],
      );
      return r.rows[0];
    });
  }
  config(ctx: RequestContext) {
    return withTenant(
      this.pool,
      ctx,
      'trust.read',
      async (t) =>
        (
          await t.db.query(
            'SELECT DISTINCT ON(key) key,version,value,effective_from FROM app.config_version WHERE tenant_id=$1 AND effective_from<=now() ORDER BY key,version DESC',
            [t.tenantId],
          )
        ).rows,
    );
  }
  audit(ctx: RequestContext) {
    return withTenant(
      this.pool,
      ctx,
      'audit.read',
      async (t) =>
        (
          await t.db.query(
            'SELECT id,type,aggregate_type,aggregate_id,actor_id,occurred_at,correlation_id FROM app.domain_event WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 50',
            [t.tenantId],
          )
        ).rows,
    );
  }
}
