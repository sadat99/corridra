import { createHash, createHmac } from 'node:crypto';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import { briefSchema, missionCommand, noticeVersion } from '@corridra/domain/missions';
export const digest = (v: string) => createHash('sha256').update(v).digest('hex');
export class MissionService {
  constructor(
    private pool: DatabasePool,
    private secret: string,
  ) {}
  private hash(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }
  async importBrief(tx: TenantTransaction, commandId: string, ownerId: string, input: unknown) {
    const brief = briefSchema.parse(input);
    const result = await tx.db.query('SELECT app.import_mission_brief($1,$2,$3,$4::jsonb) AS id', [
      tx.tenantId,
      commandId,
      ownerId,
      JSON.stringify(brief),
    ]);
    return result.rows[0].id as string;
  }
  async budget(client: string) {
    // All replicas share PostgreSQL budgets; no raw addresses are retained.
    const r = await this.pool.query(
      'SELECT app.intake_budget($1,6) AS client,app.intake_budget($2,60) AS global',
      [this.hash(`intake-client:${client}`), this.hash('intake-global')],
    );
    if (!r.rows[0].client || !r.rows[0].global)
      throw new DomainError('Too many requests. Try again in an hour.', 429);
  }
  async submit(key: string, input: unknown) {
    const brief = briefSchema.parse(input);
    const receipt = this.hash(`intake-receipt:${key}`);
    const h = this.hash(`intake-brief:${JSON.stringify(brief)}`);
    const r = await this.pool.query('SELECT app.submit_mission($1,$2,$3,$4::jsonb,$5) AS result', [
      key,
      h,
      digest(receipt),
      JSON.stringify(brief),
      noticeVersion,
    ]);
    const result = r.rows[0].result as { id?: string; duplicate: boolean };
    return { ...result, receipt: result.id ? receipt : undefined };
  }
  async receipt(token: string) {
    const r = await this.pool.query('SELECT app.mission_receipt($1) AS receipt', [digest(token)]);
    if (!r.rows[0].receipt) throw new DomainError('Receipt unavailable or expired', 404);
    return r.rows[0].receipt;
  }
  queue(ctx: RequestContext, filter: 'all' | 'open' | 'overdue' = 'all', offset = 0) {
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, role }) => {
      const where =
        "m.tenant_id=$1 AND ($2='all' OR (m.status NOT IN ('CANCELLED','CLOSED') AND ($2<>'overdue' OR m.due_at<now())))";
      const missions = (
        await db.query(
          `WITH scoped_missions AS MATERIALIZED (
        SELECT m.* FROM app.mission m WHERE ${where}
      ), scoped_intakes AS MATERIALIZED (
        SELECT i.* FROM app.mission_intake i WHERE i.tenant_id=$1
          AND i.id IN (SELECT id FROM scoped_missions)
      ), scoped_markets AS MATERIALIZED (
        SELECT mk.* FROM app.mission_market mk WHERE mk.tenant_id=$1
          AND mk.mission_id IN (SELECT id FROM scoped_missions)
      ), page AS MATERIALIZED (
        SELECT m.*,i.brief,i.notice_version,i.acknowledged_at,i.source_kind,i.claim_status,i.retention_until,mk.country_code
        FROM scoped_missions m JOIN scoped_intakes i ON i.tenant_id=m.tenant_id AND i.id=m.id
        JOIN scoped_markets mk ON mk.tenant_id=m.tenant_id AND mk.mission_id=m.id
        ORDER BY CASE WHEN m.status IN ('CANCELLED','CLOSED') THEN 1 ELSE 0 END,m.due_at,m.id LIMIT 100 OFFSET $3
      ), profiles AS MATERIALIZED (
        SELECT DISTINCT ON (tp.mission_id) tp.mission_id,tp.description
        FROM app.target_profile tp WHERE tp.tenant_id=$1 AND tp.mission_id IN (SELECT id FROM page)
        ORDER BY tp.mission_id,tp.version DESC
      )
      SELECT p.*,tp.description AS target_profile FROM page p LEFT JOIN profiles tp ON tp.mission_id=p.id
      ORDER BY CASE WHEN p.status IN ('CANCELLED','CLOSED') THEN 1 ELSE 0 END,p.due_at,p.id`,
          [ctx.tenantId, filter, offset],
        )
      ).rows;
      const ids = missions.map((m) => m.id);
      return {
        role,
        missions,
        total: (
          await db.query(`SELECT count(*)::int AS n FROM app.mission m WHERE ${where}`, [
            ctx.tenantId,
            filter,
          ])
        ).rows[0].n,
        owners: (await db.query('SELECT * FROM app.mission_owners($1)', [ctx.tenantId])).rows,
        history: (
          await db.query(
            'SELECT id,mission_id,action,reason,details,actor_id,resulting_version,created_at FROM app.mission_command WHERE tenant_id=$1 AND mission_id=ANY($2::uuid[]) ORDER BY created_at DESC',
            [ctx.tenantId, ids],
          )
        ).rows,
        replies: (
          await db.query(
            'SELECT * FROM app.mission_reply WHERE tenant_id=$1 AND mission_id=ANY($2::uuid[]) ORDER BY created_at DESC',
            [ctx.tenantId, ids],
          )
        ).rows,
      };
    });
  }
  command(ctx: RequestContext, input: unknown) {
    const v = missionCommand.parse(input),
      h = digest(JSON.stringify(v));
    return withTenant(this.pool, ctx, 'missions.manage', async ({ db, actorId }) => {
      const {
        rows: [m],
      } = await db.query('SELECT * FROM app.mission WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
        ctx.tenantId,
        v.id,
      ]);
      if (!m) throw new DomainError('Mission not found', 404);
      const {
        rows: [old],
      } = await db.query('SELECT * FROM app.mission_command WHERE id=$1', [v.commandId]);
      if (old) {
        if (old.input_hash !== h || old.actor_id !== actorId)
          throw new DomainError('Command key reused', 409);
        return { version: old.resulting_version };
      }
      if (m.version !== v.version)
        throw new DomainError('Mission changed. Refresh before continuing.', 409);
      if (['CANCELLED', 'CLOSED'].includes(m.status))
        throw new DomainError('Mission is closed', 409);
      let status = m.status,
        held = m.held_from;
      if (v.action === 'qualify') {
        if (status !== 'DRAFT') throw new DomainError('Only a draft can enter qualification', 409);
        status = 'QUALIFICATION';
      }
      if (v.action === 'activate') {
        if (status !== 'QUALIFICATION')
          throw new DomainError('Qualify the mission before activating', 409);
        status = 'ACTIVE';
      }
      if (v.action === 'targeting') {
        if (status !== 'ACTIVE')
          throw new DomainError('Activate the mission before targeting', 409);
        status = 'TARGETING';
      }
      if (v.action === 'outreach') {
        if (status !== 'TARGETING') throw new DomainError('Begin targeting before outreach', 409);
        status = 'OUTREACH';
      }
      if (v.action === 'meetings') {
        if (status !== 'OUTREACH') throw new DomainError('Begin outreach before meetings', 409);
        status = 'MEETINGS';
      }
      if (v.action === 'followup') {
        if (status !== 'MEETINGS')
          throw new DomainError('Complete a meeting before follow-up', 409);
        status = 'FOLLOW_UP';
      }
      if (v.action === 'pipeline') {
        if (status !== 'FOLLOW_UP')
          throw new DomainError('Complete meeting follow-up before commercial progression', 409);
        status = 'COMMERCIAL_PIPELINE';
      }
      if (v.action === 'close') {
        if (status !== 'COMMERCIAL_PIPELINE')
          throw new DomainError('Resolve the commercial pipeline before closing', 409);
        status = 'CLOSED';
      }
      if (v.action === 'pause') {
        if (
          ![
            'QUALIFICATION',
            'ACTIVE',
            'TARGETING',
            'OUTREACH',
            'MEETINGS',
            'FOLLOW_UP',
            'COMMERCIAL_PIPELINE',
          ].includes(status)
        )
          throw new DomainError('Only a qualified or active mission can be paused', 409);
        held = status;
        status = 'ON_HOLD';
      }
      if (v.action === 'resume') {
        if (status !== 'ON_HOLD') throw new DomainError('Mission is not on hold', 409);
        status = held;
        held = null;
      }
      if (v.action === 'cancel') {
        status = 'CANCELLED';
        held = null;
      }
      if (v.action === 'qualify') {
        const {
          rows: [i],
        } = await db.query('SELECT * FROM app.mission_intake WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          v.id,
        ]);
        if (new Date(i.retention_until) <= new Date())
          throw new DomainError('Intake retention has expired', 409);
        const {
          rows: [source],
        } = await db.query(
          `INSERT INTO app.source_record(tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by)
        VALUES($1,'self_declaration',$2,$3,'INTERNAL',$4,$5,'DENY',$6) RETURNING id`,
          [
            ctx.tenantId,
            `Mission intake ${v.id}; notice ${i.notice_version}`,
            i.created_at,
            ctx.purpose,
            i.retention_until,
            actorId,
          ],
        );
        const {
          rows: [claim],
        } = await db.query(
          `INSERT INTO app.claim(tenant_id,source_id,statement,classification,purpose,created_by) VALUES($1,$2,$3,'INTERNAL',$4,$5) RETURNING id`,
          [ctx.tenantId, source.id, i.brief.offer, ctx.purpose, actorId],
        );
        await db.query(
          'UPDATE app.commercial_intent SET claim_id=$3 WHERE tenant_id=$1 AND mission_id=$2',
          [ctx.tenantId, v.id, claim.id],
        );
      }
      await db.query(
        'UPDATE app.mission_market SET country_code=$3 WHERE tenant_id=$1 AND mission_id=$2',
        [ctx.tenantId, v.id, v.marketCode],
      );
      await db.query(
        'INSERT INTO app.target_profile(tenant_id,mission_id,description,version) VALUES($1,$2,$3,$4)',
        [ctx.tenantId, v.id, v.targetProfile, m.version + 1],
      );
      await db.query(
        'UPDATE app.mission SET status=$3,held_from=$4,version=version+1,owner_id=$5,next_action=$6,due_at=$7,reason=$8 WHERE tenant_id=$1 AND id=$2',
        [ctx.tenantId, v.id, status, held, v.ownerId, v.nextAction, v.dueAt, v.reason],
      );
      await db.query(
        'INSERT INTO app.mission_command(id,tenant_id,mission_id,input_hash,reason,action,actor_id,resulting_version,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
        [
          v.commandId,
          ctx.tenantId,
          v.id,
          h,
          v.reason,
          v.action,
          actorId,
          m.version + 1,
          JSON.stringify(v),
        ],
      );
      return { version: m.version + 1 };
    });
  }
  reply(ctx: RequestContext, id: string, body: string, replyId: string) {
    return withTenant(this.pool, ctx, 'missions.manage', async ({ db, actorId }) => {
      await db.query('SELECT id FROM app.mission WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [
        ctx.tenantId,
        id,
      ]);
      const {
        rows: [old],
      } = await db.query('SELECT * FROM app.mission_reply WHERE id=$1', [replyId]);
      if (old) {
        if (old.mission_id !== id || old.body !== body || old.created_by !== actorId)
          throw new DomainError('Reply key reused', 409);
        return { id: old.id };
      }
      const r = await db.query(
        'INSERT INTO app.mission_reply(id,tenant_id,mission_id,body,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [replyId, ctx.tenantId, id, body, actorId],
      );
      return r.rows[0];
    });
  }
}
