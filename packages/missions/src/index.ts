import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  briefSchema,
  realBriefSchema,
  missionCommand,
  noticeVersion,
  realNoticeVersion,
  missionStatus,
} from '@corridra/domain/missions';
import { z } from 'zod';
export const queueFilters = z
  .object({
    owner: z.uuid().optional(),
    stage: missionStatus.optional(),
    route: z.uuid().optional(),
    job: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{0,79}$/)
      .optional(),
  })
  .strict();
export const digest = (v: string) => createHash('sha256').update(v).digest('hex');
export class MissionService {
  constructor(
    private pool: DatabasePool,
    private secret: string,
    private intakeMode: 'synthetic' | 'real' = 'synthetic',
  ) {}
  private hash(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }
  /** Server-only capability. The HTTP adapter sends it only in an HttpOnly cookie. */
  pendingRequestCapability(value: string) {
    const match = /^([a-f0-9-]{36})\.([a-f0-9]{64})$/.exec(value);
    if (!match || !z.uuid().safeParse(match[1]).success)
      throw new DomainError('Request handoff is unavailable', 400);
    const expected = this.hash('customer-pending-request-v1:' + match[1]);
    if (!timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(expected, 'hex')))
      throw new DomainError('Request handoff is unavailable', 403);
    return { id: match[1], hash: digest(match[2]) };
  }
  async stagePendingRequest(commandId: string, input: unknown) {
    if (this.intakeMode !== 'real') throw new DomainError('Real intake is unavailable', 503);
    const id = z.uuid().parse(commandId);
    const brief = realBriefSchema.parse(input);
    const possession = this.hash('customer-pending-request-v1:' + id);
    const result = await this.pool.query(
      'SELECT customer.stage_pending_request($1,$2,$3::jsonb) AS result',
      [id, digest(possession), JSON.stringify(brief)],
    );
    return { ...result.rows[0].result, cookie: id + '.' + possession } as {
      id: string;
      expiresAt: string;
      cookie: string;
    };
  }
  async importBrief(tx: TenantTransaction, commandId: string, ownerId: string, input: unknown) {
    const brief = (this.intakeMode === 'real' ? realBriefSchema : briefSchema).parse(input);
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
      this.intakeMode === 'real'
        ? 'SELECT customer.real_request_budget($1,120) AS client,customer.real_request_budget($2,10000) AS global'
        : 'SELECT app.intake_budget($1,6) AS client,app.intake_budget($2,60) AS global',
      [
        this.hash(`${this.intakeMode === 'real' ? 'real-' : ''}intake-client:${client}`),
        this.hash(`${this.intakeMode === 'real' ? 'real-' : ''}intake-global`),
      ],
    );
    if (!r.rows[0].client || !r.rows[0].global)
      throw new DomainError('Too many requests. Try again in an hour.', 429);
  }
  async realIntakeAvailable() {
    if (this.intakeMode !== 'real') return false;
    return (
      await this.pool.query<{ available: boolean }>(
        'SELECT customer.intake_available() AS available',
      )
    ).rows[0].available;
  }
  // Pure canonical intake preparation, also used by the customer attestation boundary.
  // No database authority, receipt URL or customer ownership is granted here.
  prepareIntake(key: string, input: unknown) {
    const brief = (this.intakeMode === 'real' ? realBriefSchema : briefSchema).parse(input);
    const namespace = this.intakeMode === 'real' ? 'real:' : '';
    const receipt = this.hash(`intake-receipt:${namespace}${key}`);
    return {
      brief,
      receipt,
      payloadHash: this.hash(`intake-brief:${namespace}${JSON.stringify(brief)}`),
      receiptHash: digest(receipt),
      noticeVersion: this.intakeMode === 'real' ? realNoticeVersion : noticeVersion,
    };
  }
  prepareCustomerIntake(
    context: {
      issuer: string;
      subject: string;
      workspaceId: string;
      commandId: string;
      synthetic?: boolean;
    },
    input: unknown,
  ): { key: string; payloadHash: string; receiptHash: string; noticeVersion: string } {
    const mode =
      context.synthetic === undefined ? this.intakeMode : context.synthetic ? 'synthetic' : 'real';
    if (mode !== this.intakeMode)
      return new MissionService(this.pool, this.secret, mode).prepareCustomerIntake(
        { ...context, synthetic: undefined },
        input,
      );
    const namespace = this.intakeMode === 'real' ? 'customer-intake-real-v1' : 'customer-intake-v1';
    const hex = this.hash(
      `${namespace}:${JSON.stringify([
        context.issuer,
        context.subject,
        context.workspaceId,
        context.commandId,
      ])}`,
    )
      .slice(0, 32)
      .split('');
    hex[12] = '8';
    hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
    const text = hex.join('');
    const key = `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
    const plan = this.prepareIntake(key, input);
    // The private service never receives the bearer receipt itself.
    return {
      key,
      payloadHash: plan.payloadHash,
      receiptHash: plan.receiptHash,
      noticeVersion: plan.noticeVersion,
    };
  }
  async submit(key: string, input: unknown) {
    const {
      brief,
      receipt,
      payloadHash: h,
      receiptHash,
      noticeVersion: submissionNotice,
    } = this.prepareIntake(key, input);
    const r = await this.pool.query('SELECT app.submit_mission($1,$2,$3,$4::jsonb,$5) AS result', [
      key,
      h,
      receiptHash,
      JSON.stringify(brief),
      submissionNotice,
    ]);
    const result = r.rows[0].result as { id?: string; duplicate: boolean };
    return { ...result, receipt: result.id ? receipt : undefined };
  }
  async receipt(token: string) {
    const r = await this.pool.query('SELECT app.mission_receipt($1) AS receipt', [digest(token)]);
    if (!r.rows[0].receipt) throw new DomainError('Receipt unavailable or expired', 404);
    return r.rows[0].receipt;
  }
  queue(
    ctx: RequestContext,
    filter: 'all' | 'open' | 'overdue' = 'all',
    offset = 0,
    filters: z.infer<typeof queueFilters> = {},
  ) {
    const selected = queueFilters.parse(filters);
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, role }) => {
      const where = `m.tenant_id=$1 AND ($2='all' OR (m.status NOT IN ('CANCELLED','CLOSED') AND ($2<>'overdue' OR m.due_at<now())))
         AND ($3::uuid IS NULL OR m.owner_id=$3) AND ($4::text IS NULL OR m.status=$4)
         AND (($5::uuid IS NULL AND $6::text IS NULL) OR EXISTS(SELECT FROM app.mission_route_assignment a JOIN app.corridor_pack_version p ON p.tenant_id=a.tenant_id AND p.id=a.pack_id JOIN app.mission_type_definition t ON t.tenant_id=a.tenant_id AND t.id=a.mission_type_id WHERE a.tenant_id=m.tenant_id AND a.mission_id=m.id AND a.version=(SELECT max(version) FROM app.mission_route_assignment WHERE tenant_id=m.tenant_id AND mission_id=m.id) AND ($5::uuid IS NULL OR p.route_id=$5) AND ($6::text IS NULL OR t.key=$6)))`;
      const args = [
        ctx.tenantId,
        filter,
        selected.owner ?? null,
        selected.stage ?? null,
        selected.route ?? null,
        selected.job ?? null,
      ];
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
        ORDER BY CASE WHEN m.status IN ('CANCELLED','CLOSED') THEN 1 ELSE 0 END,m.due_at,m.id LIMIT 100 OFFSET $7
      ), profiles AS MATERIALIZED (
        SELECT DISTINCT ON (tp.mission_id) tp.mission_id,tp.description
        FROM app.target_profile tp WHERE tp.tenant_id=$1 AND tp.mission_id IN (SELECT id FROM page)
        ORDER BY tp.mission_id,tp.version DESC
      )
      SELECT p.*,tp.description AS target_profile FROM page p LEFT JOIN profiles tp ON tp.mission_id=p.id
      ORDER BY CASE WHEN p.status IN ('CANCELLED','CLOSED') THEN 1 ELSE 0 END,p.due_at,p.id`,
          [...args, offset],
        )
      ).rows;
      const ids = missions.map((m) => m.id);
      return {
        role,
        missions,
        total: (await db.query(`SELECT count(*)::int AS n FROM app.mission m WHERE ${where}`, args))
          .rows[0].n,
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
        if (!['ACTIVE', 'TARGETING', 'FOLLOW_UP'].includes(status))
          throw new DomainError('An active qualified commercial mission is required', 409);
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
