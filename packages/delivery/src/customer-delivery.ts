import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
export const customerDeliveryInput = z
  .object({
    commandId: z.uuid(),
    requestId: z.uuid(),
    linkId: z.uuid(),
    reason: z.string().trim().min(3).max(500),
    approved: z.literal(true),
  })
  .strict();
export class CustomerDeliveryService {
  constructor(private pool: DatabasePool) {}
  options(ctx: RequestContext, missionId: string) {
    z.uuid().parse(missionId);
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db, role }) => {
      if (!['owner', 'admin'].includes(role))
        throw new DomainError('Owner/admin review required', 403);
      return (await db.query('SELECT app.customer_delivery_options($1) result', [missionId]))
        .rows[0].result;
    });
  }
  assign(ctx: RequestContext, input: unknown) {
    const v = customerDeliveryInput.parse(input);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db, actorId }) => {
      await db.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('customer.delivery.link:'||$1::text||':'||$2::text,0))",
        [ctx.tenantId, v.linkId],
      );
      const previous = (
        await db.query(
          'SELECT * FROM app.customer_delivery_assignment WHERE tenant_id=$1 AND id=$2',
          [ctx.tenantId, v.commandId],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.created_by !== actorId ||
          previous.request_id !== v.requestId ||
          previous.link_id !== v.linkId ||
          previous.reason !== v.reason
        )
          throw new DomainError('Account delivery command conflicts', 409);
        return (await db.query('SELECT app.customer_delivery_receipt($1) result', [previous.id]))
          .rows[0].result as { id: string };
      }
      await db.query(
        'INSERT INTO app.customer_delivery_assignment(id,tenant_id,request_id,link_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [v.commandId, ctx.tenantId, v.requestId, v.linkId, v.reason, actorId],
      );
      return { id: v.commandId };
    });
  }
}
