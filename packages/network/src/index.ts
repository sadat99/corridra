import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { sessionHash, withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { eventInput, profileInput, taskInput } from './schema';
export { eventInput, profileInput, taskInput } from './schema';
const reason = z.string().trim().min(3).max(500);
export class NetworkService {
  constructor(
    private pool: DatabasePool,
    private enabled: boolean,
  ) {}
  private assertEnabled() {
    if (!this.enabled) throw new DomainError('Execution network is disabled', 503);
  }
  rule(ctx: RequestContext, raw: unknown) {
    this.assertEnabled();
    const v = z
      .object({
        id: z.uuid().toLowerCase(),
        key: z.string().min(3).max(80),
        version: z.number().int().positive(),
        amountMinor: z.string().regex(/^[1-9][0-9]{0,17}$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
        effectiveFrom: z.iso.datetime({ offset: true }),
        effectiveUntil: z.iso.datetime({ offset: true }),
        reason,
      })
      .strict()
      .parse(raw);
    return withTenant(
      this.pool,
      ctx,
      'opportunities.accounting',
      async (t) =>
        (
          await t.db.query(
            'INSERT INTO app.reward_rule_version(id,tenant_id,key,version,amount_minor,currency,effective_from,effective_until,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,version',
            [
              v.id,
              t.tenantId,
              v.key,
              v.version,
              v.amountMinor,
              v.currency,
              v.effectiveFrom,
              v.effectiveUntil,
              v.reason,
              t.actorId,
            ],
          )
        ).rows[0],
    );
  }
  profile(ctx: RequestContext, raw: unknown) {
    this.assertEnabled();
    const v = profileInput.parse(raw);
    return withTenant(
      this.pool,
      ctx,
      'opportunities.accounting',
      async (t) =>
        (
          await t.db.query(
            'INSERT INTO app.network_profile(id,tenant_id,principal_id,version,configuration,eligibility_source_id,expires_at,created_by,reason) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING id,version',
            [
              v.id,
              t.tenantId,
              v.principalId,
              v.version,
              JSON.stringify(v),
              v.eligibilitySourceId,
              v.expiresAt,
              t.actorId,
              v.reason,
            ],
          )
        ).rows[0],
    );
  }
  task(ctx: RequestContext, raw: unknown) {
    this.assertEnabled();
    const v = taskInput.parse(raw);
    return withTenant(this.pool, ctx, 'missions.manage', async (t) => {
      // Verification needs a different human reviewer: the creator never reviews their own task.
      if (v.reviewerId === t.actorId)
        throw new DomainError(
          'Choose a reviewer other than yourself. The person who creates a task cannot review it.',
          409,
        );
      const routeAssignmentId =
        v.routeAssignmentId ??
        (
          await t.db.query(
            'SELECT id FROM app.mission_route_assignment WHERE tenant_id=$1 AND mission_id=$2 ORDER BY version DESC LIMIT 1',
            [t.tenantId, v.missionId],
          )
        ).rows[0]?.id;
      if (!routeAssignmentId)
        throw new DomainError(
          'This mission has no route yet. Assign a route to the mission before creating a task.',
          409,
        );
      const task = { ...v, routeAssignmentId };
      return (
        await t.db.query(
          'INSERT INTO app.network_task(id,tenant_id,mission_id,route_assignment_id,configuration,reviewer_id,reward_rule_id,deadline,expires_at,created_by,reason) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) RETURNING id',
          [
            task.id,
            t.tenantId,
            task.missionId,
            routeAssignmentId,
            JSON.stringify(task),
            task.reviewerId,
            task.rewardRuleId,
            task.deadline,
            task.expiresAt,
            t.actorId,
            task.reason,
          ],
        )
      ).rows[0];
    });
  }
  event(ctx: RequestContext, raw: unknown) {
    this.assertEnabled();
    const v = eventInput.parse(raw);
    if (['ACCEPT', 'SUBMIT', 'DISPUTE'].includes(v.action))
      return this.contributor(ctx, 'app.network_contributor_command($1,$2::jsonb)', [
        ctx.tenantId,
        JSON.stringify(v),
      ]);
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      const hash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
      await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        t.tenantId + ':network:' + v.taskId,
      ]);
      const old = (
        await t.db.query(
          'SELECT input_hash,created_by,version FROM app.network_event WHERE tenant_id=$1 AND id=$2',
          [t.tenantId, v.commandId],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== hash || old.created_by !== t.actorId)
          throw new DomainError('Command key reused', 409);
        return { version: old.version, duplicate: true };
      }
      const r = await t.db.query(
        'INSERT INTO app.network_event(id,tenant_id,task_id,version,action,details,input_hash,reason,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id,version',
        [
          v.commandId,
          t.tenantId,
          v.taskId,
          v.version + 1,
          v.action,
          JSON.stringify(v.details),
          hash,
          v.reason,
          t.actorId,
        ],
      );
      return r.rows[0];
    });
  }
  async reviewSubmission(ctx: RequestContext, raw: unknown) {
    this.assertEnabled();
    const v = z
      .object({
        commandId: z.uuid().toLowerCase(),
        taskId: z.uuid().toLowerCase(),
        version: z.number().int().nonnegative(),
        evidenceQuality: z.number().int().min(0).max(4),
        timeliness: z.number().int().min(0).max(4),
        rationale: reason,
        reason,
      })
      .strict()
      .parse(raw);
    // Materialize the actual declaration, never fabricate an independent verification.
    return withTenant(this.pool, ctx, 'trust.write', async (t) => {
      await t.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        t.tenantId + ':network:' + v.taskId,
      ]);
      const task = (
        await t.db.query('SELECT * FROM app.network_task WHERE tenant_id=$1 AND id=$2', [
          t.tenantId,
          v.taskId,
        ])
      ).rows[0];
      const submission = (
        await t.db.query(
          'SELECT * FROM app.network_event WHERE tenant_id=$1 AND task_id=$2 ORDER BY version DESC LIMIT 1',
          [t.tenantId, v.taskId],
        )
      ).rows[0];
      if (
        !task ||
        task.reviewer_id !== t.actorId ||
        !t.freshMfa ||
        submission?.action !== 'SUBMIT' ||
        submission.version !== v.version
      )
        throw new DomainError('Submitted task and current reviewer required', 409);
      const source = (
        await t.db.query(
          `INSERT INTO app.source_record(tenant_id,kind,locator,observed_at,classification,purpose,retention_until,ai_policy,created_by) VALUES($1,'self_declaration',$2,$3,'INTERNAL',$6,$4,'DENY',$5) RETURNING id`,
          [
            t.tenantId,
            `Restricted network task ${v.taskId}; submission ${submission.id}; declarant ${submission.created_by}`,
            submission.created_at,
            task.expires_at,
            t.actorId,
            t.purpose,
          ],
        )
      ).rows[0];
      const claim = (
        await t.db.query(
          "INSERT INTO app.claim(tenant_id,source_id,statement,classification,purpose,created_by) VALUES($1,$2,$3,'INTERNAL',$5,$4) RETURNING id",
          [t.tenantId, source.id, submission.details.body, t.actorId, t.purpose],
        )
      ).rows[0];
      const details = {
        kind: 'review',
        sourceId: source.id,
        claimId: claim.id,
        evidenceQuality: v.evidenceQuality,
        timeliness: v.timeliness,
        rationale: v.rationale,
        verificationId: null,
      };
      await t.db.query(
        "INSERT INTO app.network_event(id,tenant_id,task_id,version,action,details,input_hash,reason,created_by) VALUES($1,$2,$3,$4,'REVIEW',$5::jsonb,$6,$7,$8)",
        [
          v.commandId,
          t.tenantId,
          v.taskId,
          v.version + 1,
          JSON.stringify(details),
          createHash('sha256').update(JSON.stringify(v)).digest('hex'),
          v.reason,
          t.actorId,
        ],
      );
      return {
        sourceId: source.id,
        claimId: claim.id,
        version: v.version + 1,
        status: 'REVIEW',
        verification: 'UNVERIFIED_DECLARATION',
      };
    });
  }
  assess(ctx: RequestContext, raw: unknown) {
    this.assertEnabled();
    const v = z.object({ taskId: z.uuid().toLowerCase(), reason }).strict().parse(raw);
    return withTenant(
      this.pool,
      ctx,
      'missions.manage',
      async (t) =>
        (
          await t.db.query('SELECT app.network_assess($1,$2,$3) AS id', [
            t.tenantId,
            v.taskId,
            v.reason,
          ])
        ).rows[0],
    );
  }
  reward(ctx: RequestContext, raw: unknown) {
    this.assertEnabled();
    const v = z
      .object({
        commandId: z.uuid().toLowerCase(),
        contributionId: z.uuid().toLowerCase(),
        sourceId: z.uuid().toLowerCase(),
        reason,
      })
      .strict()
      .parse(raw);
    return withTenant(this.pool, ctx, 'opportunities.accounting', async (t) => {
      const existing = (
        await t.db.query(
          "SELECT id FROM app.service_ledger WHERE tenant_id=$1 AND contribution_id=$2 AND kind='CONTRIBUTOR_REWARD' AND reverse_of IS NULL",
          [t.tenantId, v.contributionId],
        )
      ).rows[0];
      if (existing) return { id: existing.id, duplicate: true };
      const r = await t.db.query(
        `INSERT INTO app.service_ledger(id,tenant_id,mission_id,kind,amount_minor,currency,source_id,contribution_id,rule_id,external_reference,occurred_at,reason,created_by)
 SELECT $1,c.tenant_id,c.mission_id,'CONTRIBUTOR_REWARD',rule.amount_minor,rule.currency,$3,c.id,rule.id,$4,now(),$5,$6 FROM app.contribution c JOIN app.network_task task ON task.tenant_id=c.tenant_id AND c.task_key='network:'||task.id::text JOIN app.reward_rule_version rule ON rule.tenant_id=task.tenant_id AND rule.id=task.reward_rule_id WHERE c.tenant_id=$2 AND c.id=$7 RETURNING id`,
        [
          v.commandId,
          t.tenantId,
          v.sourceId,
          'network-reward:' + v.contributionId,
          v.reason,
          t.actorId,
          v.contributionId,
        ],
      );
      if (!r.rowCount)
        throw new DomainError('Contribution or disclosed reward rule unavailable', 409);
      return { id: r.rows[0].id, paymentGuaranteed: false };
    });
  }
  reverse(ctx: RequestContext, raw: unknown) {
    const v = z
      .object({
        commandId: z.uuid().toLowerCase(),
        ledgerId: z.uuid().toLowerCase(),
        sourceId: z.uuid().toLowerCase(),
        reason,
      })
      .strict()
      .parse(raw);
    return withTenant(this.pool, ctx, 'opportunities.accounting', async (t) => {
      const r = await t.db.query(
        `INSERT INTO app.service_ledger(id,tenant_id,mission_id,kind,amount_minor,currency,source_id,contribution_id,rule_id,reverse_of,external_reference,occurred_at,reason,created_by) SELECT $1,tenant_id,mission_id,kind,-amount_minor,currency,$3,contribution_id,rule_id,id,$4,now(),$5,$6 FROM app.service_ledger WHERE tenant_id=$2 AND id=$7 AND reverse_of IS NULL RETURNING id`,
        [
          v.commandId,
          t.tenantId,
          v.sourceId,
          'network-reversal:' + v.ledgerId,
          v.reason,
          t.actorId,
          v.ledgerId,
        ],
      );
      if (!r.rowCount) throw new DomainError('Original obligation unavailable', 404);
      return r.rows[0];
    });
  }
  async mine(ctx: RequestContext) {
    this.assertEnabled();
    return this.contributor(ctx, 'app.network_my_tasks($1)', [ctx.tenantId]);
  }
  private async contributor(ctx: RequestContext, expression: string, values: unknown[]) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const purpose =
        process.env.CORRIDRA_REAL_USE_ENABLED === 'true' && ctx.purpose === 'synthetic_validation'
          ? (
              await db.query<{ purpose: string }>(
                'SELECT app.tenant_processing_purpose($1) AS purpose',
                [ctx.tenantId],
              )
            ).rows[0].purpose
          : ctx.purpose;
      await db.query(
        "SELECT set_config('corridra.session_hash',$1,true),set_config('corridra.tenant_id',$2,true),set_config('corridra.purpose',$5,true),set_config('corridra.correlation_id',$3,true),set_config('corridra.causation_id',$4,true)",
        [
          sessionHash(ctx.token),
          ctx.tenantId,
          ctx.correlationId ?? randomUUID(),
          ctx.causationId ?? randomUUID(),
          purpose,
        ],
      );
      const r = await db.query(`SELECT ${expression} AS result`, values);
      await db.query('COMMIT');
      return r.rows[0].result;
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    } finally {
      db.release();
    }
  }
  workspace(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'trust.write', async (t) => ({
      purpose: t.purpose,
      enabled:
        this.enabled &&
        (
          await t.db.query("SELECT app.part4_enabled($1,'network.enabled') AS enabled", [
            t.tenantId,
          ])
        ).rows[0].enabled,
      performance: (
        await t.db.query('SELECT * FROM app.network_performance WHERE tenant_id=$1', [t.tenantId])
      ).rows,
      profiles: (
        await t.db.query(
          'SELECT id,principal_id,version,configuration,expires_at FROM app.network_profile WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
          [t.tenantId],
        )
      ).rows,
      tasks: (
        await t.db.query(
          "SELECT t.*,EXISTS(SELECT FROM app.network_event submission WHERE submission.tenant_id=t.tenant_id AND submission.task_id=t.id AND submission.action='SUBMIT' AND submission.created_at>t.deadline) AS late_submission,(SELECT coalesce(jsonb_agg(jsonb_build_object('action',h.action,'version',h.version,'reason',h.reason,'details',h.details,'createdAt',h.created_at) ORDER BY h.version),'[]'::jsonb) FROM app.network_event h WHERE h.tenant_id=t.tenant_id AND h.task_id=t.id) AS history,coalesce(e.version,0) AS version,coalesce(e.action,'CREATED') AS status FROM app.network_task t LEFT JOIN LATERAL (SELECT version,action FROM app.network_event WHERE tenant_id=t.tenant_id AND task_id=t.id ORDER BY version DESC LIMIT 1) e ON true WHERE t.tenant_id=$1 ORDER BY t.created_at DESC LIMIT 100",
          [t.tenantId],
        )
      ).rows,
    }));
  }
}
