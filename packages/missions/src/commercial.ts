import { createHash } from 'node:crypto';
import {
  withTenant,
  type DatabasePool,
  type RequestContext,
  type TenantTransaction,
} from '@corridra/db';
import { DomainError } from '@corridra/domain';
import {
  commercialMissionCommand,
  compareOffers,
  offerContext,
} from '@corridra/domain/commercial-missions';
import { replyQuotationPrefill } from '@corridra/domain/reply-review';
import { z } from 'zod';

// ADR-081: the only refusals of app.bind_reply_quotation that are shown as words. Matched by exact message and answered with the
// fixed text below, so nothing the database says, and nothing a supplier typed, can reach a person through this path.
const replyBindingRefusals = new Map<string, number>([
  ['Access denied', 403],
  ['Reply not found', 404],
  ['Reply review is not open', 409],
  ['This reply is already recorded as an offer', 409],
  ['This reply has not been published', 409],
  ['Reply version changed; reload before confirming', 409],
  ['This reply changed after it was published', 409],
  ['Offer does not match the published reply', 409],
  ['Offer source must be a self-declared source', 409],
  ['Offer must be recorded in this request', 409],
  ['Invalid reply binding', 400],
]);
const bindFunction = 'app.bind_reply_quotation(uuid,uuid,integer,text)';
const prefillFunction = 'app.reply_quotation_prefill(uuid)';
export type CommercialCommandOptions = {
  /** True only where the reply switch is on (CORRIDRA_REPLY_PAGE); false refuses a reply-bound offer instead of recording a plain one. */
  replyBinding?: boolean;
};

export class CommercialMissionService {
  constructor(private pool: DatabasePool) {}
  workspace(ctx: RequestContext, missionId: string) {
    z.uuid().parse(missionId);
    return withTenant(this.pool, ctx, 'missions.read', async ({ db, role }) => {
      const mission = (
        await db.query(
          'SELECT m.*,i.brief FROM app.mission m JOIN app.mission_intake i ON i.tenant_id=m.tenant_id AND i.id=m.id WHERE m.tenant_id=$1 AND m.id=$2',
          [ctx.tenantId, missionId],
        )
      ).rows[0];
      if (!mission) throw new DomainError('Mission unavailable', 404);
      const assignments = (
        await db.query(
          'SELECT a.*,t.key AS type_key,r.origin_market,r.destination_market,p.configuration FROM app.mission_route_assignment a LEFT JOIN app.mission_type_definition t ON t.tenant_id=a.tenant_id AND t.id=a.mission_type_id LEFT JOIN app.corridor_pack_version p ON p.tenant_id=a.tenant_id AND p.id=a.pack_id LEFT JOIN app.corridor_route r ON r.tenant_id=p.tenant_id AND r.id=p.route_id WHERE a.tenant_id=$1 AND a.mission_id=$2 ORDER BY a.version DESC',
          [ctx.tenantId, missionId],
        )
      ).rows;
      const data: Record<string, Record<string, unknown>[]> = {};
      for (const [key, table] of Object.entries({
        requirements: 'mission_requirements',
        assessments: 'mission_assessment',
        rfqs: 'mission_rfq',
        quotations: 'mission_quotation',
        decisions: 'mission_selection',
        schedules: 'mission_schedule',
      }))
        data[key] = (
          await db.query(
            `SELECT * FROM app.${table} WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at DESC,id LIMIT 100`,
            [ctx.tenantId, missionId],
          )
        ).rows;
      const offers = (
        await db.query(
          `SELECT q.*,EXISTS(SELECT FROM app.source_record s JOIN app.claim c ON c.tenant_id=s.tenant_id AND c.source_id=s.id JOIN app.mission_requirements req ON req.tenant_id=s.tenant_id AND req.id=q.requirement_id WHERE s.tenant_id=q.tenant_id AND s.id=q.source_id AND c.id=q.claim_id AND s.retention_until>now() AND req.version=(SELECT max(version) FROM app.mission_requirements WHERE tenant_id=q.tenant_id AND mission_id=q.mission_id) AND req.assignment_id=(SELECT id FROM app.mission_route_assignment WHERE tenant_id=q.tenant_id AND mission_id=q.mission_id ORDER BY version DESC LIMIT 1)) evidence_current FROM app.mission_quotation q WHERE q.tenant_id=$1 AND q.mission_id=$2 AND NOT EXISTS(SELECT FROM app.mission_quotation n WHERE n.tenant_id=q.tenant_id AND n.previous_id=q.id) ORDER BY q.created_at DESC,q.id LIMIT 100`,
          [ctx.tenantId, missionId],
        )
      ).rows;
      const meetings = (
        await db.query(
          'SELECT * FROM app.meeting WHERE tenant_id=$1 AND mission_id=$2 ORDER BY created_at DESC LIMIT 100',
          [ctx.tenantId, missionId],
        )
      ).rows;
      const schedules = data.schedules.map((s) => ({
        ...s,
        entries: (s.entries as { meetingId?: string }[]).map((e) =>
          e.meetingId
            ? { ...e, appointment: meetings.find((m) => m.id === e.meetingId) ?? null }
            : e,
        ),
      }));
      return {
        role,
        mission,
        assignments,
        requirements: data.requirements,
        assessments: data.assessments,
        rfqs: data.rfqs,
        quotations: data.quotations,
        decisions: data.decisions,
        schedules,
        meetings,
        owners: (await db.query('SELECT * FROM app.mission_owners($1)', [ctx.tenantId])).rows,
        targets: (
          await db.query(
            'SELECT t.id,t.relationship_id,o.name FROM app.target_account t JOIN app.relationship r ON r.tenant_id=t.tenant_id AND r.id=t.relationship_id JOIN app.organisation o ON o.id=r.organisation_id WHERE t.tenant_id=$1 AND t.mission_id=$2',
            [ctx.tenantId, missionId],
          )
        ).rows,
        comparison: compareOffers(
          offers.map((o) => ({
            id: o.id,
            currency: o.currency,
            terms: o.terms,
            requirementId: o.requirement_id,
            uncertainties: o.uncertainties,
            evidenceCurrent: o.evidence_current,
          })),
          undefined,
          offerContext(assignments[0]?.type_key),
        ),
      };
    });
  }
  async command(ctx: RequestContext, input: unknown, options: CommercialCommandOptions = {}) {
    const v = commercialMissionCommand.parse(input),
      hash = createHash('sha256').update(JSON.stringify(v)).digest('hex');
    return withTenant(this.pool, ctx, 'missions.manage', async ({ db, actorId }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        ctx.tenantId + ':commercial-missions',
      ]);
      const old = (
        await db.query(
          'SELECT * FROM app.commercial_mission_command WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, v.commandId],
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== hash || old.created_by !== actorId)
          throw new DomainError('Command key reused with different values', 409);
        return old.result as { id: string };
      }
      const row: Record<string, unknown> = {
        id: v.commandId,
        tenant_id: ctx.tenantId,
        mission_id: v.missionId,
        reason: v.reason,
        created_by: actorId,
      };
      let table: string;
      if (v.action === 'requirements') {
        table = 'mission_requirements';
        Object.assign(row, {
          assignment_id: v.assignmentId,
          definition_id: v.definitionId,
          version: v.version,
          schema_version: v.schemaVersion,
          declaration: v.declaration,
          fields: JSON.stringify(v.fields),
          source_id: v.sourceId,
          claim_id: v.claimId,
          reviewer_id: v.reviewerId ?? null,
        });
      } else if (v.action === 'schedule') {
        table = 'mission_schedule';
        Object.assign(row, { version: v.version, entries: JSON.stringify(v.entries) });
      } else {
        Object.assign(row, { source_id: v.sourceId, claim_id: v.claimId });
        if (v.action === 'assessment') {
          const assignment = (
            await db.query(
              'SELECT d.schema FROM app.mission_requirements q JOIN app.assessment_definition d ON d.tenant_id=q.tenant_id AND d.id=$3 WHERE q.tenant_id=$1 AND q.id=$2',
              [ctx.tenantId, v.requirementId, v.definitionId],
            )
          ).rows[0];
          const required = z.array(z.string()).min(1).parse(assignment?.schema.criteria);
          if (required.some((k) => !v.results.some((r) => r.criterion === k)))
            throw new DomainError('Complete the configured assessment criteria', 400);
          table = 'mission_assessment';
          Object.assign(row, {
            requirement_id: v.requirementId,
            definition_id: v.definitionId,
            target_id: v.targetId,
            version: v.version,
            method: v.method,
            observed_at: v.observedAt,
            results: JSON.stringify(v.results),
            technical_results: JSON.stringify(v.technicalResults ?? []),
            unknowns: v.unknowns,
            gaps: v.gaps,
            rationale: v.rationale,
          });
        } else if (v.action === 'rfq') {
          table = 'mission_rfq';
          Object.assign(row, {
            requirement_id: v.requirementId,
            target_ids: v.targetIds,
            buyer_context: v.buyerContext,
            requested_terms: v.requestedTerms,
            due_at: v.dueAt,
          });
        } else if (v.action === 'quotation') {
          // Never record a plain offer when the team asked to record a reply: fail closed before anything is written.
          if (v.replyBinding) await this.requireReplyBinding(db, bindFunction, options);
          const rfq = (
            await db.query(
              'SELECT requirement_id FROM app.mission_rfq WHERE tenant_id=$1 AND id=$2',
              [ctx.tenantId, v.rfqId],
            )
          ).rows[0];
          if (!rfq) throw new DomainError('RFQ unavailable', 404);
          table = 'mission_quotation';
          Object.assign(row, {
            requirement_id: rfq.requirement_id,
            rfq_id: v.rfqId,
            target_id: v.targetId,
            revision: v.revision,
            previous_id: v.previousId ?? null,
            currency: v.currency,
            terms: JSON.stringify(v.terms),
            uncertainties: v.uncertainties,
            observed_at: v.observedAt,
          });
        } else {
          table = 'mission_selection';
          Object.assign(row, {
            requirement_id: v.requirementId,
            target_id: v.targetId,
            assessment_id: v.assessmentId,
            quotation_id: v.quotationId ?? null,
            decision: v.decision,
            rationale: v.rationale,
            next_action: v.nextAction,
            owner_id: v.ownerId,
            due_at: v.dueAt,
          });
        }
      }
      const keys = Object.keys(row);
      await db.query(
        `INSERT INTO app.${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
        Object.values(row),
      );
      if (v.action === 'quotation' && v.replyBinding) {
        try {
          await db.query('SELECT app.bind_reply_quotation($1,$2,$3,$4)', [
            v.commandId,
            v.replyBinding.responseId,
            v.replyBinding.seen,
            v.replyBinding.digest,
          ]);
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          const status = replyBindingRefusals.get(message);
          if (status === undefined) throw error;
          throw new DomainError(message, status);
        }
      }
      const result = { id: v.commandId };
      await db.query(
        'INSERT INTO app.commercial_mission_command(id,tenant_id,mission_id,action,input_hash,result,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [v.commandId, ctx.tenantId, v.missionId, v.action, hash, result, actorId],
      );
      return result;
    });
  }
  /** The published reply, typed for the offer form (ADR-081). Authority is checked before anything is read. */
  async replyPrefill(ctx: RequestContext, replyId: string, options: CommercialCommandOptions = {}) {
    const reply = z.uuid().parse(replyId);
    return withTenant(this.pool, ctx, 'missions.manage', async ({ db }) => {
      await this.requireReplyBinding(db, prefillFunction, options);
      const row = (await db.query('SELECT app.reply_quotation_prefill($1) AS prefill', [reply]))
        .rows[0];
      const prefill = replyQuotationPrefill.safeParse(row.prefill);
      // The database answered with a shape this code does not know: an internal fault, not a bad request.
      if (!prefill.success) throw new Error('Reply prefill returned an unknown shape');
      return prefill.data;
    });
  }
  private async requireReplyBinding(
    db: TenantTransaction['db'],
    signature: string,
    options: CommercialCommandOptions,
  ) {
    if (!options.replyBinding) throw new DomainError('Reply binding is unavailable', 503);
    const present = (
      await db.query('SELECT to_regprocedure($1) IS NOT NULL AS present', [signature])
    ).rows[0].present;
    if (!present) throw new DomainError('Reply binding is unavailable', 503);
  }
}
