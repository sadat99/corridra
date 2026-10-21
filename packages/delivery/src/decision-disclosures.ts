import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
export const decisionDisclosureInput = z
  .object({
    commandId: z.uuid(),
    publicationId: z.uuid(),
    version: z.number().int().positive(),
    decisionIds: z
      .array(z.uuid())
      .max(30)
      .refine((v) => new Set(v).size === v.length),
    reason: z.string().trim().min(3).max(500),
    approved: z.literal(true),
  })
  .strict();
export class DecisionDisclosureService {
  constructor(private pool: DatabasePool) {}
  options(ctx: RequestContext, publicationId: string) {
    z.uuid().parse(publicationId);
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db, actorId, role, purpose }) => {
      if (!['owner', 'admin'].includes(role))
        throw new DomainError('Owner/admin review required', 403);
      const p = (
        await db.query(
          'SELECT p.id,p.mission_id FROM app.delivery_publication p WHERE p.tenant_id=$1 AND p.id=$2 AND p.created_by=$3',
          [ctx.tenantId, publicationId, actorId],
        )
      ).rows[0];
      if (!p) throw new DomainError('Own active publication required', 403);
      const decisions = (
        await db.query(
          'SELECT d.id,d.target_id,d.decision,d.rationale,d.next_action,d.due_at,d.quotation_id,s.kind source_kind,c.status claim_status FROM app.mission_selection d JOIN app.source_record s ON s.tenant_id=d.tenant_id AND s.id=d.source_id JOIN app.claim c ON c.tenant_id=d.tenant_id AND c.id=d.claim_id JOIN app.delivery_experience_publication e ON e.tenant_id=d.tenant_id AND e.publication_id=$2 WHERE d.tenant_id=$1 AND d.mission_id=$3 AND d.requirement_id=e.requirement_id AND d.target_id=ANY(e.target_ids) AND (d.quotation_id IS NULL OR d.quotation_id=ANY(e.quotation_ids)) ORDER BY d.created_at DESC,d.id LIMIT 100',
          [ctx.tenantId, publicationId, p.mission_id],
        )
      ).rows;
      const approvals = (
        await db.query(
          'SELECT id,version,decision_ids,reason,created_at FROM app.delivery_decision_publication WHERE tenant_id=$1 AND publication_id=$2 ORDER BY version DESC LIMIT 25',
          [ctx.tenantId, publicationId],
        )
      ).rows;
      return {
        publicationId,
        decisions,
        approvals,
        nextVersion: (approvals[0]?.version ?? 0) + 1,
        synthetic: purpose === 'synthetic_validation',
      };
    });
  }
  approve(ctx: RequestContext, input: unknown) {
    const value = decisionDisclosureInput.parse(input);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db, actorId }) => {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('delivery-decision:'||$1::text||':'||$2::text,0))",
        [ctx.tenantId, value.publicationId],
      );
      const old = (
        await db.query(
          'SELECT * FROM app.delivery_decision_publication WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, value.commandId],
        )
      ).rows[0];
      if (old) {
        if (
          old.created_by !== actorId ||
          old.publication_id !== value.publicationId ||
          old.version !== value.version ||
          old.reason !== value.reason ||
          JSON.stringify(old.decision_ids) !== JSON.stringify(value.decisionIds)
        )
          throw new DomainError('Disclosure command conflicts', 409);
        return (await db.query('SELECT app.decision_disclosure_receipt($1) result', [old.id]))
          .rows[0].result as { id: string; version: number };
      }
      await db.query(
        'INSERT INTO app.delivery_decision_publication(id,tenant_id,publication_id,version,decision_ids,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          value.commandId,
          ctx.tenantId,
          value.publicationId,
          value.version,
          value.decisionIds,
          value.reason,
          actorId,
        ],
      );
      return { id: value.commandId, version: value.version };
    });
  }
}
