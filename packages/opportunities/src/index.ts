import { commercialOrigin } from '@corridra/domain/opportunities';
import { createHash } from 'node:crypto';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  commercialCommand,
  assertOpportunityTransition,
  type OpportunityStatus,
} from '@corridra/domain/opportunities';
export class OpportunityService {
  constructor(private pool: DatabasePool) {}
  workspace(ctx: RequestContext, missionId?: string, offset = 0) {
    return withTenant(this.pool, ctx, 'opportunities.read', async ({ db, role, freshMfa }) => {
      const where = 'tenant_id=$1 AND ($2::uuid IS NULL OR mission_id=$2)';
      const opportunities = (
        await db.query(
          `SELECT * FROM app.opportunity WHERE ${where} ORDER BY due_at,id LIMIT 50 OFFSET $3`,
          [ctx.tenantId, missionId ?? null, offset],
        )
      ).rows;
      const ids = opportunities.map((o) => o.id);
      const records = (
        await db.query(
          'SELECT * FROM app.commercial_record WHERE tenant_id=$1 AND opportunity_id=ANY($2::uuid[]) ORDER BY occurred_at,id LIMIT 501',
          [ctx.tenantId, ids],
        )
      ).rows;
      const recordCounts = (
        await db.query(
          'SELECT opportunity_id,count(*)::int n FROM app.commercial_record WHERE tenant_id=$1 AND opportunity_id=ANY($2::uuid[]) GROUP BY opportunity_id',
          [ctx.tenantId, ids],
        )
      ).rows;
      const confirmations = (
        await db.query(
          'SELECT * FROM app.accounting_confirmation WHERE tenant_id=$1 AND record_id=ANY($2::uuid[]) ORDER BY created_at,id',
          [ctx.tenantId, records.slice(0, 500).map((r) => r.id)],
        )
      ).rows;
      const history = (
        await db.query(
          'SELECT * FROM app.commercial_command WHERE tenant_id=$1 AND opportunity_id=ANY($2::uuid[]) ORDER BY created_at DESC,id LIMIT 100',
          [ctx.tenantId, ids],
        )
      ).rows;
      const missions = (
        await db.query(
          "SELECT m.id,i.brief->>'company' AS label FROM app.mission m JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id WHERE m.tenant_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 1000",
          [ctx.tenantId],
        )
      ).rows;
      const meetings = (
        await db.query(
          `SELECT mt.id,mt.title,mt.mission_id FROM app.meeting mt JOIN app.mission m ON m.tenant_id=mt.tenant_id AND m.id=mt.mission_id WHERE mt.tenant_id=$1 AND mt.status='HELD' AND m.status IN ('FOLLOW_UP','COMMERCIAL_PIPELINE') ORDER BY mt.created_at DESC,mt.id LIMIT 100`,
          [ctx.tenantId],
        )
      ).rows;
      const sources = (
        await db.query(
          "SELECT id,kind,locator FROM app.source_record WHERE tenant_id=$1 AND retention_until>now() AND ai_policy='DENY' AND classification IN ('PUBLIC','INTERNAL') ORDER BY created_at DESC,id LIMIT 100",
          [ctx.tenantId],
        )
      ).rows;
      const evidence = (
        await db.query(
          `SELECT e.id,c.source_id,s.status,s.scan_status FROM app.evidence_object e JOIN app.claim c ON c.tenant_id=e.tenant_id AND c.id=e.claim_id JOIN app.evidence_state s ON s.tenant_id=e.tenant_id AND s.id=e.id WHERE e.tenant_id=$1 AND e.classification IN ('PUBLIC','INTERNAL') AND e.retention_until>now() AND s.status IN ('UNDER_REVIEW','VERIFIED') AND s.scan_status IN ('CLEAN','BYPASSED') ORDER BY e.created_at DESC,e.id LIMIT 100`,
          [ctx.tenantId],
        )
      ).rows;
      const owners = (await db.query('SELECT * FROM app.mission_owners($1)', [ctx.tenantId])).rows;
      const enabled = (await db.query('SELECT app.commercial_enabled($1) enabled', [ctx.tenantId]))
        .rows[0].enabled;
      const total = (
        await db.query(`SELECT count(*)::int n FROM app.opportunity WHERE ${where}`, [
          ctx.tenantId,
          missionId ?? null,
        ])
      ).rows[0].n;
      const overdue = (
        await db.query(
          `SELECT id,title,owner_id,next_action,due_at FROM app.opportunity WHERE ${where} AND due_at<now() AND status NOT IN ('LOST','RECURRING_REVENUE') ORDER BY due_at,id LIMIT 50`,
          [ctx.tenantId, missionId ?? null],
        )
      ).rows;
      const meetingFollowups = (
        await db.query(
          `SELECT f.id,f.owner_id,f.next_action,f.due_at,mt.mission_id FROM app.follow_up f JOIN app.meeting mt ON mt.tenant_id=f.tenant_id AND mt.id=f.meeting_id WHERE f.tenant_id=$1 AND ($2::uuid IS NULL OR mt.mission_id=$2) AND f.status='OPEN' AND f.due_at<now() ORDER BY f.due_at,f.id LIMIT 50`,
          [ctx.tenantId, missionId ?? null],
        )
      ).rows;
      const metrics = (
        await db.query(
          `WITH scoped AS MATERIALIZED(SELECT id FROM app.opportunity WHERE ${where}), attained AS MATERIALIZED(SELECT DISTINCT e.opportunity_id,e.snapshot->>'status' status FROM app.outcome_event e WHERE e.tenant_id=$1 AND e.entity_type='opportunity' AND e.opportunity_id IN(SELECT id FROM scoped))
    SELECT count(*)::int opportunities,
     count(*) FILTER(WHERE EXISTS(SELECT FROM attained WHERE opportunity_id=o.id AND app.commercial_stage(status)>=2))::int qualified,
     count(*) FILTER(WHERE EXISTS(SELECT FROM attained WHERE opportunity_id=o.id AND app.commercial_stage(status)>=3))::int proposals,
     count(*) FILTER(WHERE EXISTS(SELECT FROM attained WHERE opportunity_id=o.id AND app.commercial_stage(status)>=4))::int commitments,
     count(*) FILTER(WHERE EXISTS(SELECT FROM attained WHERE opportunity_id=o.id AND app.commercial_stage(status)>=5))::int contracts,
     count(*) FILTER(WHERE EXISTS(SELECT FROM attained WHERE opportunity_id=o.id AND app.commercial_stage(status)>=6))::int invoices,
     count(*) FILTER(WHERE EXISTS(SELECT FROM attained WHERE opportunity_id=o.id AND app.commercial_stage(status)>=7))::int cash,
     count(*) FILTER(WHERE EXISTS(SELECT FROM attained WHERE opportunity_id=o.id AND app.commercial_stage(status)>=8))::int recurrence,
     count(*) FILTER(WHERE o.status='LOST')::int lost FROM app.opportunity o WHERE ${where}`,
          [ctx.tenantId, missionId ?? null],
        )
      ).rows[0];
      const totals = (
        await db.query(
          `SELECT * FROM app.commercial_totals($1,ARRAY(SELECT id FROM app.opportunity WHERE ${where}))`,
          [ctx.tenantId, missionId ?? null],
        )
      ).rows;
      const activity = (
        await db.query(
          `SELECT
    (SELECT count(*)::int FROM app.target_account WHERE tenant_id=$1 AND ($2::uuid IS NULL OR mission_id=$2)) targets,
    (SELECT count(*)::int FROM app.communication c JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id WHERE c.tenant_id=$1 AND ($2::uuid IS NULL OR t.mission_id=$2)) introductions,
    (SELECT count(*)::int FROM app.meeting mt WHERE mt.tenant_id=$1 AND ($2::uuid IS NULL OR mt.mission_id=$2) AND EXISTS(SELECT FROM app.meeting_command mc WHERE mc.tenant_id=mt.tenant_id AND mc.meeting_id=mt.id AND mc.details->'command'->>'status'='ACCEPTED')) accepted_meetings,
    (SELECT count(*)::int FROM app.meeting WHERE tenant_id=$1 AND ($2::uuid IS NULL OR mission_id=$2) AND status='HELD') held_meetings,
    (SELECT count(*)::int FROM app.commercial_record r JOIN app.opportunity o ON o.tenant_id=r.tenant_id AND o.id=r.opportunity_id WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR o.mission_id=$2) AND r.kind='RFQ') rfqs,
    (SELECT count(*)::int FROM app.commercial_record r JOIN app.opportunity o ON o.tenant_id=r.tenant_id AND o.id=r.opportunity_id WHERE r.tenant_id=$1 AND ($2::uuid IS NULL OR o.mission_id=$2) AND r.kind='SAMPLE') samples`,
          [ctx.tenantId, missionId ?? null],
        )
      ).rows[0];
      return {
        role,
        freshMfa,
        enabled,
        opportunities,
        total,
        records: records.slice(0, 500),
        recordsTruncated: records.length > 500,
        recordCounts,
        confirmations,
        history,
        meetings,
        origins: (
          await db.query(
            "SELECT c.id,c.mission_id,c.kind,c.summary FROM app.commercial_origin c JOIN app.mission m ON m.tenant_id=c.tenant_id AND m.id=c.mission_id WHERE c.tenant_id=$1 AND m.status IN ('ACTIVE','TARGETING','FOLLOW_UP','COMMERCIAL_PIPELINE') ORDER BY c.created_at DESC LIMIT 100",
            [ctx.tenantId],
          )
        ).rows,
        missions,
        sources,
        evidence,
        owners,
        overdue,
        meetingFollowups,
        metrics,
        totals,
        activity,
        projectionVersion: 1,
        attributionScope: 'MISSION_ASSOCIATED',
        scope: {
          missionId: missionId ?? null,
          visibility: 'Current actor access',
          funnel: 'Historical stages attained; net cash reflects confirmed corrections',
        },
      };
    });
  }
  records(ctx: RequestContext, id: string, offset = 0) {
    return withTenant(this.pool, ctx, 'opportunities.read', async ({ db }) => {
      if (
        !(
          await db.query('SELECT id FROM app.opportunity WHERE tenant_id=$1 AND id=$2', [
            ctx.tenantId,
            id,
          ])
        ).rowCount
      )
        throw new DomainError('Opportunity unavailable', 404);
      const records = (
        await db.query(
          'SELECT * FROM app.commercial_record WHERE tenant_id=$1 AND opportunity_id=$2 ORDER BY occurred_at,id LIMIT 100 OFFSET $3',
          [ctx.tenantId, id, offset],
        )
      ).rows;
      const confirmations = (
        await db.query(
          'SELECT * FROM app.accounting_confirmation WHERE tenant_id=$1 AND record_id=ANY($2::uuid[])',
          [ctx.tenantId, records.map((r) => r.id)],
        )
      ).rows;
      return {
        records,
        confirmations,
        total: (
          await db.query(
            'SELECT count(*)::int n FROM app.commercial_record WHERE tenant_id=$1 AND opportunity_id=$2',
            [ctx.tenantId, id],
          )
        ).rows[0].n,
      };
    });
  }
  registerOrigin(ctx: RequestContext, input: unknown) {
    const v = commercialOrigin.parse(input);
    return withTenant(this.pool, ctx, 'opportunities.manage', async ({ db, actorId }) => {
      await db.query(
        'INSERT INTO app.commercial_origin(id,tenant_id,mission_id,target_id,kind,source_id,claim_id,message_id,summary,created_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          v.id,
          ctx.tenantId,
          v.missionId,
          v.targetId,
          v.kind,
          v.sourceId,
          v.claimId,
          v.messageId ?? null,
          v.summary,
          actorId,
          v.reason,
        ],
      );
      return { id: v.id };
    });
  }
  command(ctx: RequestContext, input: unknown) {
    const v = commercialCommand.parse(input),
      hash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
    const accounting = ['confirm', 'reverse', 'rebuild'].includes(v.action);
    return withTenant(
      this.pool,
      ctx,
      accounting ? 'opportunities.accounting' : 'opportunities.manage',
      async ({ db, actorId }) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `${ctx.tenantId}:commercial`,
        ]);
        if (
          !(await db.query('SELECT app.commercial_enabled($1) enabled', [ctx.tenantId])).rows[0]
            .enabled
        )
          throw new DomainError('Commercial commands are disabled', 409);
        const old = (
          await db.query('SELECT * FROM app.commercial_command WHERE tenant_id=$1 AND id=$2', [
            ctx.tenantId,
            v.commandId,
          ])
        ).rows[0];
        if (old) {
          if (old.input_hash !== hash || old.created_by !== actorId)
            throw new DomainError('Command key reused with different values', 409);
          return old.result as { id: string; version?: number; events?: number };
        }
        let opportunityId: string | null = null;
        let result: { id: string; version?: number; events?: number };
        if (v.action === 'create' || v.action === 'createFromOrigin') {
          const m = (
            await db.query(
              v.action === 'create'
                ? `SELECT mt.*,c.target_id FROM app.meeting mt JOIN app.communication c ON c.tenant_id=mt.tenant_id AND c.id=mt.message_id WHERE mt.tenant_id=$1 AND mt.id=$2 AND mt.status='HELD'`
                : 'SELECT * FROM app.commercial_origin WHERE tenant_id=$1 AND id=$2',
              [ctx.tenantId, v.action === 'create' ? v.meetingId : v.originId],
            )
          ).rows[0];
          if (!m)
            throw new DomainError(
              v.action === 'create' ? 'Held meeting unavailable' : 'Commercial origin unavailable',
              404,
            );
          opportunityId = v.commandId;
          await db.query(
            v.action === 'create'
              ? 'INSERT INTO app.opportunity(id,tenant_id,meeting_id,mission_id,target_id,title,attribution,owner_id,next_action,due_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)'
              : 'INSERT INTO app.opportunity(id,tenant_id,meeting_id,mission_id,target_id,title,attribution,owner_id,next_action,due_at,reason,created_by,origin_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
            [
              opportunityId,
              ctx.tenantId,
              v.action === 'create' ? m.id : null,
              m.mission_id,
              m.target_id,
              v.title,
              v.attribution,
              v.ownerId,
              v.nextAction,
              v.dueAt,
              v.reason,
              actorId,
              ...(v.action === 'createFromOrigin' ? [m.id] : []),
            ],
          );
          result = { id: opportunityId, version: 1 };
        } else if (v.action === 'transition' || v.action === 'followup') {
          const o = (
            await db.query(
              'SELECT * FROM app.opportunity WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
              [ctx.tenantId, v.id],
            )
          ).rows[0];
          if (!o) throw new DomainError('Opportunity unavailable', 404);
          if (o.version !== v.version)
            throw new DomainError('Opportunity changed. Refresh before continuing.', 409);
          if (v.action === 'transition') {
            assertOpportunityTransition(o.status as OpportunityStatus, v.status);
            if ((v.status === 'LOST') !== !!v.lossReason)
              throw new DomainError(
                'Record a loss reason only when closing a lost opportunity',
                400,
              );
          }
          opportunityId = o.id;
          await db.query(
            'UPDATE app.opportunity SET status=$3,version=version+1,owner_id=$4,next_action=$5,due_at=$6,reason=$7,loss_reason=$8 WHERE tenant_id=$1 AND id=$2',
            [
              ctx.tenantId,
              v.id,
              v.action === 'transition' ? v.status : o.status,
              v.ownerId,
              v.nextAction,
              v.dueAt,
              v.reason,
              v.action === 'transition' ? (v.lossReason ?? null) : o.loss_reason,
            ],
          );
          result = { id: v.id, version: o.version + 1 };
        } else if (v.action === 'record') {
          opportunityId = v.id;
          await db.query(
            `INSERT INTO app.commercial_record(id,tenant_id,opportunity_id,kind,parent_id,prior_receipt_id,source_id,evidence_id,occurred_at,summary,external_reference,reason,amount_minor,currency,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [
              v.commandId,
              ctx.tenantId,
              v.id,
              v.kind,
              v.parentId ?? null,
              v.priorReceiptId ?? null,
              v.sourceId,
              v.evidenceId ?? null,
              v.occurredAt,
              v.summary,
              v.externalReference,
              v.reason,
              v.amountMinor ?? null,
              v.currency ?? null,
              actorId,
            ],
          );
          result = { id: v.commandId };
        } else if (v.action === 'reverse' || v.action === 'confirm') {
          const r = (
            await db.query('SELECT * FROM app.commercial_record WHERE tenant_id=$1 AND id=$2', [
              ctx.tenantId,
              v.recordId,
            ])
          ).rows[0];
          if (!r) throw new DomainError('Commercial record unavailable', 404);
          opportunityId = r.opportunity_id;
          if (v.action === 'reverse') {
            if (!r.amount_minor || r.reverse_of)
              throw new DomainError('Only an original financial record can be compensated', 409);
            await db.query(
              'INSERT INTO app.commercial_record(id,tenant_id,opportunity_id,kind,parent_id,reverse_of,source_id,occurred_at,summary,external_reference,reason,amount_minor,currency,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
              [
                v.commandId,
                ctx.tenantId,
                r.opportunity_id,
                r.kind,
                r.parent_id,
                r.id,
                v.sourceId,
                v.occurredAt,
                'Full compensation of ' + r.external_reference,
                'compensation:' + v.commandId,
                v.reason,
                (-BigInt(r.amount_minor)).toString(),
                r.currency,
                actorId,
              ],
            );
          } else
            await db.query(
              'INSERT INTO app.accounting_confirmation(id,tenant_id,opportunity_id,record_id,source_id,occurred_at,basis,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
              [
                v.commandId,
                ctx.tenantId,
                r.opportunity_id,
                r.id,
                v.sourceId,
                v.occurredAt,
                v.basis,
                v.reason,
                actorId,
              ],
            );
          result = { id: v.commandId };
        } else {
          result = {
            id: v.commandId,
            events: (
              await db.query('SELECT app.rebuild_outcomes($1,$2,$3,$4) n', [
                ctx.tenantId,
                v.commandId,
                hash,
                v.reason,
              ])
            ).rows[0].n,
          };
        }
        if (v.action === 'rebuild') return result;
        await db.query(
          'INSERT INTO app.commercial_command(id,tenant_id,opportunity_id,action,input_hash,result,reason,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)',
          [
            v.commandId,
            ctx.tenantId,
            opportunityId,
            v.action,
            hash,
            JSON.stringify(result),
            v.reason,
            actorId,
          ],
        );
        return result;
      },
    );
  }
}
