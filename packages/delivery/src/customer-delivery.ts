import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';
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
  constructor(
    private pool: DatabasePool,
    private published?: (db: DatabaseClient, commandId: string) => Promise<() => Promise<unknown>>,
  ) {}

  private async recordPublished(db: DatabaseClient, commandId: string) {
    if (!this.published) return undefined;
    await db.query('SAVEPOINT report_published');
    try {
      const dispatch = await this.published(db, commandId);
      await db.query('RELEASE SAVEPOINT report_published');
      return dispatch;
    } catch {
      await db.query('ROLLBACK TO SAVEPOINT report_published');
      await db.query('RELEASE SAVEPOINT report_published');
      console.error(JSON.stringify({ event: 'report_published_notification_failed' }));
      return undefined;
    }
  }
  options(ctx: RequestContext, missionId: string) {
    z.uuid().parse(missionId);
    return withTenant(this.pool, ctx, 'delivery.read', async ({ db, role }) => {
      if (!['owner', 'admin'].includes(role))
        throw new DomainError('Owner/admin review required', 403);
      return (await db.query('SELECT app.customer_delivery_options($1) result', [missionId]))
        .rows[0].result;
    });
  }
  async assign(ctx: RequestContext, input: unknown) {
    const v = customerDeliveryInput.parse(input);
    let dispatch: (() => Promise<unknown>) | undefined;
    const result = await withTenant(this.pool, ctx, 'delivery.share', async ({ db, actorId }) => {
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
        const receipt = (
          await db.query('SELECT app.customer_delivery_receipt($1) result', [previous.id])
        ).rows[0].result as { id: string };
        dispatch = await this.recordPublished(db, v.commandId);
        return receipt;
      }
      await db.query(
        'INSERT INTO app.customer_delivery_assignment(id,tenant_id,request_id,link_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [v.commandId, ctx.tenantId, v.requestId, v.linkId, v.reason, actorId],
      );
      dispatch = await this.recordPublished(db, v.commandId);
      return { id: v.commandId };
    });
    try {
      await dispatch?.();
    } catch {
      console.error(JSON.stringify({ event: 'report_published_email_failed' }));
    }
    return result;
  }
}
