import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type DatabaseClient,
} from '@corridra/db';
import { DomainError, stepUpRequired } from '@corridra/domain';
import { routePack } from '@corridra/domain/corridors';
import {
  missionCatalogue,
  machineryFields,
  requirementFields,
} from '@corridra/domain/commercial-missions';
export const readinessDimensions = [
  'offer',
  'owner',
  'qualification',
  'research',
  'communications',
  'coverage',
  'evidence',
  'privacy',
  'dependencies',
  'support',
  'quality',
  'rollback',
  'pilot',
] as const;
const reason = z.string().trim().min(3).max(500),
  key = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
  instant = z.iso.datetime({ offset: true });
const common = { id: z.uuid(), reason };
export const operationsCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...common,
      action: z.literal('ai-budget'),
      missionId: z.uuid(),
      version: z.int().positive(),
      amountMinor: z.string().regex(/^(0|[1-9]\d{0,5})$/),
      sourceId: z.uuid(),
      validUntil: instant,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('template'),
      kind: z.enum(['MISSION_TYPE', 'REQUIREMENT', 'ASSESSMENT']),
      typeKey: key,
      version: z.int().positive(),
      description: z.string().trim().min(3).max(500),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('readiness'),
      routeId: z.uuid(),
      packId: z.uuid(),
      missionType: key,
      dimension: z.enum(readinessDimensions),
      version: z.int().positive(),
      status: z.enum(['PASS', 'BLOCKED', 'NOT_APPLICABLE']),
      ownerId: z.uuid(),
      sourceId: z.uuid().nullable(),
      validUntil: instant,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('release'),
      routeId: z.uuid(),
      packId: z.uuid(),
      missionType: key,
      version: z.int().positive(),
      state: z.enum(['UNPUBLISHED', 'SYNTHETIC_APPROVED', 'PAUSED']),
      ownerId: z.uuid(),
      readinessIds: z.array(z.uuid()).max(13),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('propose'),
      basePackId: z.uuid().nullable(),
      pack: routePack,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('decide'),
      proposalId: z.uuid(),
      decision: z.enum(['PUBLISH', 'REJECT']),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('document'),
      missionId: z.uuid(),
      kind: z.enum(['INVOICE', 'RECEIPT']),
      parentId: z.uuid().nullable(),
      reverseOf: z.uuid().nullable(),
      amountMinor: z.string().regex(/^-?[1-9]\d{0,17}$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
      sourceId: z.uuid(),
      externalReference: z.string().trim().min(3).max(200),
      occurredAt: instant,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('ledger'),
      missionId: z.uuid(),
      kind: z.enum(['SERVICE_FEE', 'DELIVERY_COST']),
      amountMinor: z.string().regex(/^-?[1-9]\d{0,17}$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
      sourceId: z.uuid(),
      externalReference: z.string().trim().min(3).max(200),
      occurredAt: instant,
      reverseOf: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('effort'),
      missionId: z.uuid(),
      operatorId: z.uuid(),
      minutes: z.int().min(1).max(1440),
      sourceId: z.uuid(),
      occurredAt: instant,
      reverseOf: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('context'),
      missionId: z.uuid(),
      version: z.int().positive(),
      customerReference: z.string().trim().min(3).max(100).nullable(),
      industry: z.string().trim().min(3).max(100).nullable(),
      acquisitionSource: z.string().trim().min(3).max(100).nullable(),
      payingStatus: z.enum(['UNKNOWN', 'PAYING', 'NON_PAYING']),
      intakeDecision: z.enum(['UNKNOWN', 'ACCEPTED', 'REJECTED']).default('UNKNOWN'),
      firstUsefulResultAt: instant.nullable().default(null),
      revenueComplete: z.boolean(),
      costComplete: z.boolean(),
      effortComplete: z.boolean(),
      sourceId: z.uuid(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal('case'),
      key: z.string().trim().min(3).max(100),
      version: z.int().positive(),
      kind: z.enum([
        'COMMUNICATION',
        'TASK',
        'REPORT',
        'PROVIDER',
        'PRIVACY',
        'SECURITY',
        'INCIDENT',
        'FRAUD',
      ]),
      subjectId: z.uuid().nullable(),
      state: z.enum(['OPEN', 'BLOCKED', 'RESOLVED']),
      ownerId: z.uuid(),
      dueAt: instant,
      sourceId: z.uuid().nullable(),
    })
    .strict(),
]);
export const operationsFilters = z
  .object({
    route: z.uuid().optional(),
    corridor: z.uuid().optional(),
    type: key.optional(),
    customer: z.string().min(3).max(100).optional(),
    industry: z.string().min(3).max(100).optional(),
    owner: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    stage: z.string().max(30).optional(),
    programme: z.uuid().optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'Date range is reversed');
async function insert(db: DatabaseClient, table: string, values: Record<string, unknown>) {
  const keys = Object.keys(values);
  await db.query(
    `INSERT INTO app.${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
    Object.values(values),
  );
}
export class OperationsService {
  constructor(private pool: DatabasePool) {}
  preview(ctx: RequestContext, input: unknown) {
    const v = routePack.parse(input);
    return withTenant(this.pool, ctx, 'audit.read', async ({ db }) => {
      const current = (
        await db.query(
          'SELECT * FROM app.corridor_pack_version WHERE tenant_id=$1 AND route_id=$2 AND effective_from<=now() ORDER BY version DESC LIMIT 1',
          [ctx.tenantId, v.routeId],
        )
      ).rows[0];
      const route = (
        await db.query('SELECT id FROM app.corridor_route WHERE tenant_id=$1 AND id=$2', [
          ctx.tenantId,
          v.routeId,
        ])
      ).rows[0];
      if (!route) throw new DomainError('Route unavailable', 404);
      if (v.version !== (current?.version ?? 0) + 1)
        throw new DomainError('Next sequential pack version required', 409);
      const assignments = (
        await db.query(
          'SELECT count(*)::int count FROM app.mission_route_assignment a JOIN app.corridor_pack_version p ON p.tenant_id=a.tenant_id AND p.id=a.pack_id WHERE a.tenant_id=$1 AND p.route_id=$2',
          [ctx.tenantId, v.routeId],
        )
      ).rows[0].count;
      return {
        basePackId: current?.id ?? null,
        changedFields: Object.keys(v.configuration).filter(
          (k) =>
            JSON.stringify(current?.configuration[k]) !==
            JSON.stringify(v.configuration[k as keyof typeof v.configuration]),
        ),
        historicalAssignmentsPreserved: assignments,
        readinessInvalidated: true,
        publiclyOperational: false,
        pack: v,
      };
    });
  }
  command(ctx: RequestContext, input: unknown) {
    const v = operationsCommand.parse(input),
      digest = createHash('sha256').update(JSON.stringify(v)).digest('hex');
    return withTenant(
      this.pool,
      ctx,
      ['propose', 'decide', 'template'].includes(v.action)
        ? 'config.manage'
        : 'opportunities.accounting',
      async ({ db, actorId, freshMfa }) => {
        if (!freshMfa) throw stepUpRequired();
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          ctx.tenantId + ':operations',
        ]);
        const old = (
          await db.query('SELECT * FROM app.operations_command WHERE tenant_id=$1 AND id=$2', [
            ctx.tenantId,
            v.id,
          ])
        ).rows[0];
        if (old) {
          if (old.input_hash !== digest || old.created_by !== actorId)
            throw new DomainError('Command key reused with different values', 409);
          return old.result;
        }
        const base = { id: v.id, tenant_id: ctx.tenantId, created_by: actorId, reason: v.reason };
        if (v.action === 'ai-budget')
          await insert(db, 'ai_mission_budget', {
            ...base,
            mission_id: v.missionId,
            version: v.version,
            amount_minor: v.amountMinor,
            source_id: v.sourceId,
            valid_until: v.validUntil,
          });
        if (v.action === 'template') {
          const t = missionCatalogue.find((t) => t.key === v.typeKey);
          if (!t) throw new DomainError('Registered capability template required', 409);
          const table = {
            MISSION_TYPE: 'mission_type_definition',
            REQUIREMENT: 'requirement_definition',
            ASSESSMENT: 'assessment_definition',
          }[v.kind];
          const templateKey = v.kind === 'MISSION_TYPE' ? t.key : t.key + '.commercial';
          const last = (
            await db.query(
              `SELECT coalesce(max(version),0)::int version FROM app.${table} WHERE tenant_id=$1 AND key=$2`,
              [ctx.tenantId, templateKey],
            )
          ).rows[0].version;
          if (v.version !== last + 1)
            throw new DomainError('Next sequential template version required', 409);
          await insert(db, table, {
            ...base,
            key: templateKey,
            version: v.version,
            description: v.description,
            ...(v.kind === 'MISSION_TYPE'
              ? {}
              : {
                  schema: {
                    schemaVersion: 1,
                    typeKey: t.key,
                    fields: Object.keys(requirementFields.shape),
                    machineryFields: t.key === 'machinery_procurement' ? [...machineryFields] : [],
                    criteria: [...t.criteria, 'evidence_completeness'],
                  },
                }),
          });
        }
        if (v.action === 'readiness')
          await insert(db, 'route_readiness', {
            ...base,
            route_id: v.routeId,
            pack_id: v.packId,
            mission_type: v.missionType,
            dimension: v.dimension,
            version: v.version,
            status: v.status,
            owner_id: v.ownerId,
            source_id: v.sourceId,
            valid_until: v.validUntil,
          });
        if (v.action === 'release')
          await insert(db, 'route_release', {
            ...base,
            route_id: v.routeId,
            pack_id: v.packId,
            mission_type: v.missionType,
            version: v.version,
            state: v.state,
            readiness_ids: v.readinessIds,
            owner_id: v.ownerId,
          });
        if (v.action === 'propose')
          await insert(db, 'configuration_proposal', {
            ...base,
            route_id: v.pack.routeId,
            base_pack_id: v.basePackId,
            proposed_pack: v.pack,
          });
        if (v.action === 'decide') {
          const q = (
            await db.query(
              'SELECT * FROM app.configuration_proposal WHERE tenant_id=$1 AND id=$2',
              [ctx.tenantId, v.proposalId],
            )
          ).rows[0];
          if (!q || q.created_by === actorId)
            throw new DomainError('An independent authorized reviewer is required', 409);
          let packId = null;
          if (v.decision === 'PUBLISH') {
            await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
              ctx.tenantId + ':corridor',
            ]);
            const p = routePack.parse(q.proposed_pack);
            const current = (
              await db.query(
                'SELECT id FROM app.corridor_pack_version WHERE tenant_id=$1 AND route_id=$2 AND effective_from<=now() ORDER BY version DESC LIMIT 1',
                [ctx.tenantId, q.route_id],
              )
            ).rows[0];
            if ((current?.id ?? null) !== q.base_pack_id)
              throw new DomainError('Configuration changed; submit a new preview', 409);
            await insert(db, 'corridor_pack_version', {
              id: p.id,
              tenant_id: ctx.tenantId,
              route_id: p.routeId,
              version: p.version,
              status: p.status,
              configuration: p.configuration,
              effective_from: p.effectiveFrom,
              created_by: actorId,
              reason: p.reason,
            });
            packId = p.id;
          }
          await insert(db, 'configuration_decision', {
            ...base,
            proposal_id: v.proposalId,
            decision: v.decision,
            published_pack_id: packId,
          });
        }
        if (v.action === 'document')
          await insert(db, 'service_document', {
            ...base,
            mission_id: v.missionId,
            kind: v.kind,
            parent_id: v.parentId,
            reverse_of: v.reverseOf,
            amount_minor: v.amountMinor,
            currency: v.currency,
            source_id: v.sourceId,
            external_reference: v.externalReference,
            occurred_at: v.occurredAt,
          });
        if (v.action === 'ledger')
          await insert(db, 'service_ledger', {
            ...base,
            mission_id: v.missionId,
            kind: v.kind,
            amount_minor: v.amountMinor,
            currency: v.currency,
            source_id: v.sourceId,
            external_reference: v.externalReference,
            occurred_at: v.occurredAt,
            reverse_of: v.reverseOf,
          });
        if (v.action === 'effort')
          await insert(db, 'mission_effort', {
            ...base,
            mission_id: v.missionId,
            operator_id: v.operatorId,
            minutes: v.minutes,
            source_id: v.sourceId,
            occurred_at: v.occurredAt,
            reverse_of: v.reverseOf,
          });
        if (v.action === 'context')
          await insert(db, 'mission_operations_context', {
            ...base,
            mission_id: v.missionId,
            version: v.version,
            customer_reference: v.customerReference,
            industry: v.industry,
            acquisition_source: v.acquisitionSource,
            paying_status: v.payingStatus,
            intake_decision: v.intakeDecision,
            first_useful_result_at: v.firstUsefulResultAt,
            revenue_complete: v.revenueComplete,
            cost_complete: v.costComplete,
            effort_complete: v.effortComplete,
            source_id: v.sourceId,
          });
        if (v.action === 'case')
          await insert(db, 'operations_case', {
            ...base,
            key: v.key,
            version: v.version,
            kind: v.kind,
            subject_id: v.subjectId,
            state: v.state,
            owner_id: v.ownerId,
            due_at: v.dueAt,
            source_id: v.sourceId,
          });
        const result = { id: v.id, action: v.action };
        await insert(db, 'operations_command', {
          id: v.id,
          tenant_id: ctx.tenantId,
          input_hash: digest,
          result,
          created_by: actorId,
        });
        return result;
      },
    );
  }
  // Owner and admin only, the same authority as the Control Center. Returns the role, nothing else.
  founderAccess(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'audit.read', async ({ role }) => ({ role }));
  }
  controlCenter(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'audit.read', async ({ db, role }) => {
      const data: Record<string, Record<string, unknown>[]> = {};
      for (const [name, sql] of Object.entries({
        markets: 'SELECT key,kind,name,country_code FROM app.market_scope ORDER BY key',
        owners: 'SELECT user_id,name FROM app.mission_owners($1)',
        readiness: `SELECT DISTINCT ON(r.route_id,r.mission_type,r.dimension) r.*, (r.valid_until>now() AND EXISTS(SELECT FROM app.corridor_pack_version p WHERE p.tenant_id=r.tenant_id AND p.id=r.pack_id AND p.version=(SELECT max(version) FROM app.corridor_pack_version WHERE tenant_id=p.tenant_id AND route_id=p.route_id AND effective_from<=now())) AND (r.status='BLOCKED' OR EXISTS(SELECT FROM app.source_record WHERE tenant_id=r.tenant_id AND id=r.source_id AND retention_until>now()))) AS current, now()::text AS checked_at FROM app.route_readiness r WHERE r.tenant_id=$1 ORDER BY r.route_id,r.mission_type,r.dimension,r.version DESC`,
        releases:
          'SELECT DISTINCT ON(route_id,mission_type) * FROM app.route_release WHERE tenant_id=$1 ORDER BY route_id,mission_type,version DESC',
        proposals:
          'SELECT p.*,d.decision,d.published_pack_id FROM app.configuration_proposal p LEFT JOIN app.configuration_decision d ON d.tenant_id=p.tenant_id AND d.proposal_id=p.id WHERE p.tenant_id=$1 ORDER BY p.created_at DESC LIMIT 100',
        cases:
          'SELECT DISTINCT ON(key) * FROM app.operations_case WHERE tenant_id=$1 ORDER BY key,version DESC',
        documents:
          'SELECT * FROM app.service_document WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
        ledger:
          'SELECT * FROM app.service_ledger WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
        effort:
          'SELECT * FROM app.mission_effort WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
        contexts:
          'SELECT DISTINCT ON(mission_id) * FROM app.mission_operations_context WHERE tenant_id=$1 ORDER BY mission_id,version DESC',
        budgets:
          'SELECT DISTINCT ON(mission_id) * FROM app.ai_mission_budget WHERE tenant_id=$1 ORDER BY mission_id,version DESC',
        privacy:
          'SELECT id,source_id,version,data_role,jurisdictions,processing_locations,retention_until,legal_hold,transfer_status FROM app.data_rights_policy WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',
        policies:
          'SELECT id,jurisdiction,channel,version,basis,enabled,effective_from,valid_until FROM app.communication_policy WHERE tenant_id=$1 ORDER BY effective_from DESC LIMIT 100',
      }))
        data[name] = (await db.query(sql, sql.includes('$1') ? [ctx.tenantId] : [])).rows;
      return {
        role,
        ...data,
        releases: data.releases,
        checkedAt: new Date().toISOString(),
        registeredTemplates: missionCatalogue.map((t) => ({
          key: t.key,
          label: t.label,
          criteria: t.criteria,
        })),
        environment: 'synthetic',
        publicActivation: false,
        sourceAdapters: ['manual_observation', 'public_record', 'self_declaration'],
        providerCredentials: 'Secret references only; credentials cannot be retrieved',
      };
    });
  }
  reliability(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, role }) => {
      if (!['owner', 'admin', 'operator'].includes(role))
        throw new DomainError('Operations access denied');
      const communications = (
        await db.query(
          `SELECT j.id,j.status,j.attempts,j.available_at,j.lease_until,j.last_error,j.workflow_run_id,c.target_id,m.owner_id FROM app.communication_dispatch j JOIN app.communication c ON c.tenant_id=j.tenant_id AND c.id=j.id JOIN app.target_account t ON t.tenant_id=c.tenant_id AND t.id=c.target_id JOIN app.mission m ON m.tenant_id=t.tenant_id AND m.id=t.mission_id WHERE j.tenant_id=$1 AND j.status<>'DELIVERED' ORDER BY j.available_at LIMIT 100`,
          [ctx.tenantId],
        )
      ).rows;
      const tasks = (
        await db.query(
          `SELECT t.id,t.mission_id,t.configuration->>'deadline' AS deadline,t.configuration->>'reviewerId' AS owner_id,e.action,t.expires_at FROM app.network_task t LEFT JOIN LATERAL(SELECT action FROM app.network_event WHERE tenant_id=t.tenant_id AND task_id=t.id ORDER BY version DESC LIMIT 1) e ON true WHERE t.tenant_id=$1 AND coalesce(e.action,'CREATED') NOT IN ('COMPLETE','CANCEL','REJECT') ORDER BY t.created_at LIMIT 100`,
          [ctx.tenantId],
        )
      ).rows;
      const ai = (
        await db.query(
          `SELECT r.id,r.mission_id,r.task,c.status,a.created_at AS attempt_at,x.status AS result_status,a.reserved_minor::text FROM app.ai_run r LEFT JOIN app.ai_completion c ON c.tenant_id=r.tenant_id AND c.run_id=r.id LEFT JOIN app.ai_attempt a ON a.tenant_id=r.tenant_id AND a.run_id=r.id LEFT JOIN app.ai_result x ON x.tenant_id=a.tenant_id AND x.attempt_id=a.id WHERE r.tenant_id=$1 AND (c.status IS NULL OR c.status='MANUAL_REVIEW') ORDER BY r.created_at DESC LIMIT 100`,
          [ctx.tenantId],
        )
      ).rows;
      const cases = (
        await db.query(
          'SELECT DISTINCT ON(key) * FROM app.operations_case WHERE tenant_id=$1 ORDER BY key,version DESC',
          [ctx.tenantId],
        )
      ).rows;
      const health = (
        await db.query(
          `SELECT true AS database_reachable,(SELECT count(*)::int FROM app.evidence_state WHERE tenant_id=$1 AND scan_status IN ('PENDING','ERROR','BYPASSED')) AS unscanned`,
          [ctx.tenantId],
        )
      ).rows[0];
      return {
        communications,
        tasks,
        ai,
        cases,
        health,
        limits: { perQueue: 100 },
        recovery:
          'Existing idempotent dispatch/retry; retained attempts; no evidence or reward auto-acceptance',
        infrastructureCost: null,
        costWarning:
          'Provider invoice and infrastructure billing are not connected; AI values are reservations, not provider invoices',
      };
    });
  }
  dashboard(ctx: RequestContext, input: unknown = {}) {
    const f = operationsFilters.parse(input);
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, role }) => {
      if (!['owner', 'admin', 'operator'].includes(role))
        throw new DomainError('Operations access denied');
      const args: unknown[] = [ctx.tenantId],
        where = ['m.tenant_id=$1'];
      const filters: Record<string, string> = {
        route: 'r.id',
        corridor: 'r.corridor_id',
        type: 'typ.key',
        customer: 'c.customer_reference',
        industry: 'c.industry',
        owner: 'm.owner_id',
      };
      for (const [name, column] of Object.entries(filters)) {
        const value = f[name as keyof typeof f];
        if (value) {
          args.push(value);
          where.push(`${column}=$${args.length}`);
        }
      }
      if (f.from) {
        args.push(f.from);
        where.push(`m.created_at>=$${args.length}::date`);
      }
      if (f.to) {
        args.push(f.to);
        where.push(`m.created_at<$${args.length}::date+interval '1 day'`);
      }
      if (f.programme) {
        args.push(f.programme);
        where.push(
          `EXISTS(SELECT FROM app.delivery_participant dp WHERE dp.tenant_id=m.tenant_id AND dp.mission_id=m.id AND dp.programme_id=$${args.length})`,
        );
      }
      if (f.stage) {
        args.push(f.stage);
        where.push(
          `EXISTS(SELECT FROM app.opportunity o WHERE o.tenant_id=m.tenant_id AND o.mission_id=m.id AND o.status=$${args.length})`,
        );
      }
      const cte = `WITH base AS (
    SELECT m.id,m.status,m.owner_id,m.created_at,m.updated_at,m.due_at,m.next_action,r.id route_id,r.origin_market,r.destination_market,typ.key mission_type,
    c.customer_reference,c.industry,c.acquisition_source,c.paying_status,c.revenue_complete,c.cost_complete,c.effort_complete,c.intake_decision,c.first_useful_result_at,
    EXISTS(SELECT FROM app.domain_event ev WHERE ev.tenant_id=m.tenant_id AND ev.aggregate_id=m.id::text AND ev.aggregate_type='mission' AND ev.payload->>'status'='QUALIFICATION') qualified,
    (SELECT count(*)::int FROM app.target_account t WHERE t.tenant_id=m.tenant_id AND t.mission_id=m.id) targets,
    (SELECT count(*)::int FROM app.target_account t JOIN LATERAL(SELECT fit FROM app.match_assessment WHERE tenant_id=t.tenant_id AND target_id=t.id ORDER BY version DESC LIMIT 1) a ON true WHERE t.tenant_id=m.tenant_id AND t.mission_id=m.id AND a.fit='STRONG') strong_targets,
    (SELECT count(*)::int FROM app.meeting mt JOIN app.meeting_outcome mo ON mo.tenant_id=mt.tenant_id AND mo.meeting_id=mt.id WHERE mt.tenant_id=m.tenant_id AND mt.mission_id=m.id AND mo.status='HELD') held_meetings,
    (SELECT count(*)::int FROM app.communication co JOIN app.target_account t ON t.tenant_id=co.tenant_id AND t.id=co.target_id JOIN app.buyer_link l ON l.tenant_id=co.tenant_id AND l.message_id=co.id JOIN app.buyer_response br ON br.tenant_id=l.tenant_id AND br.link_id=l.id WHERE t.tenant_id=m.tenant_id AND t.mission_id=m.id) responses,
    (SELECT count(*)::int FROM app.mission_quotation q WHERE q.tenant_id=m.tenant_id AND q.mission_id=m.id AND NOT EXISTS(SELECT FROM app.mission_quotation n WHERE n.tenant_id=q.tenant_id AND n.previous_id=q.id)) quotes,
    (SELECT count(*)::int FROM app.mission_assessment a WHERE a.tenant_id=m.tenant_id AND a.mission_id=m.id) technical_assessments,
    (SELECT count(*)::int FROM app.mission_rfq rf WHERE rf.tenant_id=m.tenant_id AND rf.mission_id=m.id) mission_rfqs,
    (SELECT min(t.created_at) FROM app.target_account t WHERE t.tenant_id=m.tenant_id AND t.mission_id=m.id) first_target_at,
    (SELECT min(cr.occurred_at) FROM app.commercial_record cr JOIN app.opportunity o ON o.tenant_id=cr.tenant_id AND o.id=cr.opportunity_id WHERE o.tenant_id=m.tenant_id AND o.mission_id=m.id AND cr.kind IN ('CONTRACT','CASH_RECEIPT') AND cr.reverse_of IS NULL AND NOT EXISTS(SELECT FROM app.commercial_record rev WHERE rev.tenant_id=cr.tenant_id AND rev.reverse_of=cr.id) AND cr.occurred_at>=m.created_at) first_commercial_outcome_at,
    (SELECT sum(CASE WHEN e.reverse_of IS NULL THEN e.minutes ELSE -e.minutes END)::text FROM app.mission_effort e WHERE e.tenant_id=m.tenant_id AND e.mission_id=m.id) effort_minutes,
    (SELECT jsonb_agg(jsonb_build_object('status',o.status,'lossReason',o.loss_reason)) FROM app.opportunity o WHERE o.tenant_id=m.tenant_id AND o.mission_id=m.id) opportunities,
    (SELECT jsonb_agg(jsonb_build_object('kind',x.kind,'count',x.n)) FROM (SELECT cr.kind,count(*)::int n FROM app.commercial_record cr JOIN app.opportunity o ON o.tenant_id=cr.tenant_id AND o.id=cr.opportunity_id WHERE o.tenant_id=m.tenant_id AND o.mission_id=m.id AND cr.reverse_of IS NULL GROUP BY cr.kind) x) commercial_counts
    FROM app.mission m
    LEFT JOIN LATERAL(SELECT * FROM app.mission_route_assignment WHERE tenant_id=m.tenant_id AND mission_id=m.id ORDER BY version DESC LIMIT 1) a ON true
    LEFT JOIN app.corridor_pack_version p ON p.tenant_id=a.tenant_id AND p.id=a.pack_id LEFT JOIN app.corridor_route r ON r.tenant_id=p.tenant_id AND r.id=p.route_id
    LEFT JOIN app.mission_type_definition typ ON typ.tenant_id=a.tenant_id AND typ.id=a.mission_type_id
    LEFT JOIN LATERAL(SELECT mc.* FROM app.mission_operations_context mc JOIN app.source_record s ON s.tenant_id=mc.tenant_id AND s.id=mc.source_id WHERE mc.tenant_id=m.tenant_id AND mc.mission_id=m.id AND mc.version=(SELECT max(version) FROM app.mission_operations_context WHERE tenant_id=mc.tenant_id AND mission_id=mc.mission_id) AND s.retention_until>now()) c ON true
    WHERE ${where.join(' AND ')})`;
      const summary = (
        await db.query(
          cte +
            ` SELECT count(*)::int submitted,count(*) FILTER(WHERE qualified)::int qualified,
    count(*) FILTER(WHERE status IN ('ACTIVE','TARGETING','OUTREACH','MEETINGS','FOLLOW_UP','COMMERCIAL_PIPELINE','CLOSED'))::int accepted,
    count(*) FILTER(WHERE status='CANCELLED')::int cancelled,count(*) FILTER(WHERE status='CLOSED')::int completed,
    count(*) FILTER(WHERE intake_decision='REJECTED')::int recorded_rejections,count(*) FILTER(WHERE status='CANCELLED' AND intake_decision IS DISTINCT FROM 'REJECTED')::int cancellation_reason_unclassified,
    count(*) FILTER(WHERE paying_status='PAYING')::int recorded_paying,count(*) FILTER(WHERE paying_status='NON_PAYING')::int recorded_non_paying,count(*) FILTER(WHERE paying_status IS NULL OR paying_status='UNKNOWN')::int payment_unknown,
    count(*) FILTER(WHERE status='ON_HOLD')::int blocked,count(*) FILTER(WHERE due_at<now() AND status NOT IN ('CLOSED','CANCELLED'))::int delayed,
    coalesce(sum(targets),0)::int targets,coalesce(sum(strong_targets),0)::int strong_targets,coalesce(sum(held_meetings),0)::int held_meetings,coalesce(sum(responses),0)::int responses,coalesce(sum(quotes),0)::int quotes,
    coalesce(sum(technical_assessments),0)::int technical_assessments,coalesce(sum(mission_rfqs),0)::int mission_rfqs,
    count(*) FILTER(WHERE route_id IS NULL)::int route_unknown,count(*) FILTER(WHERE customer_reference IS NULL)::int customer_unknown,
    count(*) FILTER(WHERE revenue_complete IS DISTINCT FROM true OR cost_complete IS DISTINCT FROM true)::int incomplete_economics,
    count(*) FILTER(WHERE first_target_at IS NOT NULL)::int first_target_denominator,
    count(*) FILTER(WHERE first_useful_result_at IS NOT NULL)::int useful_result_denominator,
    avg(extract(epoch FROM first_useful_result_at-created_at)) FILTER(WHERE first_useful_result_at IS NOT NULL) AS mean_seconds_to_recorded_useful_result,
    count(*) FILTER(WHERE first_commercial_outcome_at IS NOT NULL)::int commercial_outcome_denominator,
    avg(extract(epoch FROM first_commercial_outcome_at-created_at)) FILTER(WHERE first_commercial_outcome_at IS NOT NULL) AS mean_seconds_to_commercial_outcome,
    avg(extract(epoch FROM first_target_at-created_at)) FILTER(WHERE first_target_at IS NOT NULL) AS mean_seconds_to_first_recorded_target
    FROM base`,
          args,
        )
      ).rows[0];
      const page = (
        await db.query(
          cte +
            ` SELECT * FROM base ORDER BY created_at DESC,id LIMIT 50 OFFSET $${args.length + 1}`,
          [...args, f.offset],
        )
      ).rows;
      const money = (
        await db.query(
          cte +
            `, amounts AS (
    SELECT b.id mission_id,b.route_id,b.origin_market,b.destination_market,b.mission_type,b.status,b.revenue_complete,b.cost_complete,x.currency,x.kind,x.amount_minor FROM base b JOIN app.service_ledger x ON x.tenant_id=$1 AND x.mission_id=b.id
    UNION ALL SELECT b.id,b.route_id,b.origin_market,b.destination_market,b.mission_type,b.status,b.revenue_complete,b.cost_complete,x.currency,'CORRIDRA_'||x.kind,x.amount_minor FROM base b JOIN app.service_document x ON x.tenant_id=$1 AND x.mission_id=b.id)
    SELECT route_id,origin_market,destination_market,mission_type,currency,kind,sum(amount_minor)::text observed_minor,count(DISTINCT mission_id)::int recorded_mission_denominator,
    sum(amount_minor) FILTER(WHERE status='CLOSED')::text completed_observed_minor,count(DISTINCT mission_id) FILTER(WHERE status='CLOSED')::int completed_recorded_denominator
    FROM amounts GROUP BY route_id,origin_market,destination_market,mission_type,currency,kind ORDER BY origin_market,destination_market,mission_type,currency,kind`,
          args,
        )
      ).rows;
      const economics = (
        await db.query(
          cte +
            `, ledger AS (
          SELECT b.id,b.route_id,b.origin_market,b.destination_market,b.mission_type,b.status,b.effort_minutes,b.effort_complete,x.currency,
          coalesce(sum(x.amount_minor) FILTER(WHERE x.kind='SERVICE_FEE'),0)::text observed_fee_minor,
          coalesce(sum(x.amount_minor) FILTER(WHERE x.kind='DELIVERY_COST'),0)::text observed_delivery_cost_minor,
          coalesce(sum(x.amount_minor) FILTER(WHERE x.kind='CONTRIBUTOR_REWARD'),0)::text observed_reward_minor,
          CASE WHEN b.revenue_complete AND b.cost_complete AND NOT EXISTS(SELECT FROM app.service_ledger later JOIN app.mission_operations_context mc ON mc.tenant_id=later.tenant_id AND mc.mission_id=later.mission_id WHERE later.tenant_id=$1 AND later.mission_id=b.id AND mc.version=(SELECT max(version) FROM app.mission_operations_context WHERE tenant_id=mc.tenant_id AND mission_id=mc.mission_id) AND later.created_at>mc.created_at)
          THEN sum(CASE WHEN x.kind='SERVICE_FEE' THEN x.amount_minor ELSE -x.amount_minor END)::text ELSE NULL END contribution_margin_minor
          FROM base b JOIN app.service_ledger x ON x.tenant_id=$1 AND x.mission_id=b.id
          GROUP BY b.id,b.route_id,b.origin_market,b.destination_market,b.mission_type,b.status,b.effort_minutes,b.effort_complete,b.revenue_complete,b.cost_complete,x.currency)
          SELECT * FROM ledger ORDER BY origin_market,destination_market,mission_type,currency,id`,
          args,
        )
      ).rows;
      const customerTrade = (
        await db.query(
          cte +
            ` SELECT cr.kind,cr.currency,sum(cr.amount_minor)::text observed_minor,count(DISTINCT b.id)::int mission_denominator FROM base b JOIN app.opportunity o ON o.tenant_id=$1 AND o.mission_id=b.id JOIN app.commercial_record cr ON cr.tenant_id=o.tenant_id AND cr.opportunity_id=o.id WHERE cr.amount_minor IS NOT NULL GROUP BY cr.kind,cr.currency ORDER BY cr.kind,cr.currency`,
          args,
        )
      ).rows;
      const programmes = (
        await db.query(
          cte +
            ` SELECT p.id,p.name,count(DISTINCT dp.mission_id)::int matched_participants,(SELECT count(*)::int FROM app.delivery_participant allp WHERE allp.tenant_id=p.tenant_id AND allp.programme_id=p.id) total_participants,count(DISTINCT b.id) FILTER(WHERE b.held_meetings>0)::int participants_with_held_meetings,count(DISTINCT b.id) FILTER(WHERE b.status='CLOSED')::int completed_participants FROM app.delivery_programme p JOIN app.delivery_participant dp ON dp.tenant_id=p.tenant_id AND dp.programme_id=p.id JOIN base b ON b.id=dp.mission_id WHERE p.tenant_id=$1 GROUP BY p.id,p.name ORDER BY p.name`,
          args,
        )
      ).rows;
      const repeat = (
        await db.query(
          cte +
            ` SELECT customer_reference,count(*)::int recorded_missions,count(*) FILTER(WHERE status='CLOSED')::int completed_missions FROM base WHERE customer_reference IS NOT NULL GROUP BY customer_reference HAVING count(*)>1 ORDER BY customer_reference`,
          args,
        )
      ).rows;
      const commercialActivityTotals = (
        await db.query(
          cte +
            ` SELECT cr.kind,count(*)::int recorded_observations,count(DISTINCT b.id)::int mission_denominator FROM base b JOIN app.opportunity o ON o.tenant_id=$1 AND o.mission_id=b.id JOIN app.commercial_record cr ON cr.tenant_id=o.tenant_id AND cr.opportunity_id=o.id WHERE cr.reverse_of IS NULL GROUP BY cr.kind ORDER BY cr.kind`,
          args,
        )
      ).rows;
      return {
        role,
        summary,
        missions: page,
        corridraMoney: money,
        economics,
        financeAvailable: ['owner', 'admin'].includes(role),
        customerTrade,
        programmes,
        repeat,
        commercialActivityTotals,
        offset: f.offset,
        limit: 50,
        definitions: {
          scope:
            'Current tenant and authorized records; all filtered missions contribute to totals, only the mission list is paginated',
          qualified: 'Recorded qualification history',
          accepted: 'Current accepted/delivery states; cancelled is not assumed rejected',
          strongTargets: 'Latest STRONG human fit assessment; not independent verification',
          firstUsefulResult:
            'Evidence-backed recorded useful-result acceptance; absent acceptance is unknown. First target timing is a separate observable proxy.',
          paying: 'Evidence-backed operator classification; absent records are unknown',
          financial:
            'Original-currency observed subtotals; no cross-currency aggregation; customer trade is separate',
          repeat:
            'Explicit customer reference, not company-name matching; association is not causal attribution',
        },
        unknown: {
          rejected: null,
          firstUsefulResult: summary.useful_result_denominator
            ? summary.mean_seconds_to_recorded_useful_result
            : null,
          retentionRate: null,
          infrastructureCost: null,
          forecast: null,
        },
        warnings: [
          'Missing financial records are unknown, not zero. Gross contribution margin requires complete fee/cost/reward coverage for the mission and currency.',
          'Observed partner delivery costs use DELIVERY_COST; contributor obligations use CONTRIBUTOR_REWARD. Neither is a payout.',
          'Technical assessment count is activity, not an engineering certification. Programme denominator includes only the visible canonical participants.',
          'Acquisition attribution and customer references are recorded observations, not verified identity or causal attribution.',
        ],
      };
    });
  }
}
