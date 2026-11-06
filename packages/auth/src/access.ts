import { z } from 'zod';
import { DomainError, role } from '@corridra/domain';
import { withTenant, sessionHash, type Pool, type RequestContext } from '@corridra/db';
import { realUseEnabled } from './customer-production';
import { getTeamToday } from './team-today';
import { TeamControl } from './team-control';
export class AccessService {
  constructor(
    private pool: Pool,
    private identityPool?: Pool,
  ) {}
  /** Today counts for the team (CQ-34, CQ-73), read with the person's own access. */
  today(ctx: RequestContext) {
    return getTeamToday(this.pool, ctx);
  }
  /** Team invitations and authenticator reset (CQ-74, V-03). Needs the restricted auth pool. */
  team() {
    if (!this.identityPool) throw new DomainError('Team management is unavailable', 503);
    return new TeamControl(this.pool, this.identityPool);
  }
  async tenants(token: string) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.purpose','synthetic_validation',true)",
        [sessionHash(token)],
      );
      const r = await db.query(
        realUseEnabled()
          ? 'SELECT * FROM app.my_tenants() ORDER BY app.tenant_is_synthetic(id),id'
          : 'SELECT * FROM app.my_tenants()',
      );
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
          'SELECT user_id,role,revoked_at,version,allowed_purposes,allowed_classifications,allowed_countries FROM app.membership WHERE tenant_id=$1 ORDER BY created_at',
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
  /**
   * Change a member's role or revoke them. Two things keep a change from landing on a view that is out of date or from
   * landing twice: `expectedVersion` is the membership version the owner saw (it moves on with every change), and
   * `commandId` is carried into the audit event as its causation id, so a retry after a lost answer is recognised from
   * the event already written and answered once, while the same id for a different change is refused.
   */
  changeMember(ctx: RequestContext, input: unknown) {
    const v = z
      .object({
        commandId: z.uuid(),
        userId: z.uuid(),
        role,
        revoked: z.boolean(),
        expectedVersion: z.number().int().min(1).max(1_000_000),
      })
      .strict()
      .parse(input);
    return withTenant(
      this.pool,
      { ...ctx, causationId: v.commandId },
      'members.manage',
      async (t) => {
        await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [t.tenantId]);
        const replay = await t.db.query(
          `SELECT aggregate_id,payload FROM app.domain_event
           WHERE tenant_id=$1 AND aggregate_type='membership' AND causation_id=$2 LIMIT 1`,
          [t.tenantId, v.commandId],
        );
        if (replay.rowCount) {
          const earlier = replay.rows[0];
          if (
            earlier.aggregate_id !== v.userId ||
            earlier.payload.role !== v.role ||
            earlier.payload.revoked !== v.revoked
          )
            throw new DomainError('Membership command key reused', 409);
          return { updated: true, replayed: true, version: earlier.payload.version as number };
        }
        const old = await t.db.query(
          'SELECT role,version FROM app.membership WHERE tenant_id=$1 AND user_id=$2',
          [t.tenantId, v.userId],
        );
        if (!old.rowCount) throw new DomainError('Membership unavailable', 404);
        if (old.rows[0].version !== v.expectedVersion)
          throw new DomainError('This membership changed; reload and try again', 409);
        if (old.rows[0].role === 'owner' && (v.role !== 'owner' || v.revoked)) {
          const count = await t.db.query(
            "SELECT count(*)::int AS count FROM app.membership WHERE tenant_id=$1 AND role='owner' AND revoked_at IS NULL",
            [t.tenantId],
          );
          if (count.rows[0].count <= 1)
            throw new DomainError('The tenant must retain an active owner', 409);
        }
        const changed = await t.db.query(
          'UPDATE app.membership SET role=$3,revoked_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE tenant_id=$1 AND user_id=$2 RETURNING version',
          [t.tenantId, v.userId, v.role, v.revoked],
        );
        return { updated: true, replayed: false, version: changed.rows[0].version as number };
      },
    );
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
