import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';

const control = /[\u0000-\u001f\u007f]/u;
const synthetic = (max: number) =>
  z
    .string()
    .trim()
    .min(11)
    .max(max)
    .regex(/^Synthetic /)
    .refine((v) => !control.test(v), 'Control characters are not allowed');
const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !control.test(v) && !/(:\/\/|@|www\.)/.test(v), 'Plain text only');
const requestRef = { requestId: z.uuid(), expectedSeq: z.number().int().min(1).max(500) };
export const quoteComponentInput = z
  .object({
    kind: z.enum(['service_fee', 'local_cost', 'pass_through', 'tax']),
    label: synthetic(200),
    treatment: z.enum(['included', 'estimate', 'not_included']),
    // Whole minor units as digits. A cost that is not included may leave the amount out.
    amountMinor: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,10})$/)
      .nullable(),
  })
  .strict()
  .refine((c) => c.treatment === 'not_included' || c.amountMinor !== null, 'Amount required')
  .refine((c) => c.kind !== 'service_fee' || c.treatment !== 'not_included', 'Fee must be priced');
export const staffServiceCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('quote'),
      commandId: z.uuid(),
      ...requestRef,
      currency: z.string().regex(/^[A-Z]{3}$/),
      components: z.array(quoteComponentInput).min(1).max(12),
      scope: synthetic(1000),
      exclusions: z.array(synthetic(300)).min(1).max(12),
      assumptions: z.array(synthetic(300)).min(1).max(12),
      deliveryTerms: synthetic(500),
      paymentTerms: synthetic(500),
      validUntil: z.iso.datetime({ offset: false }),
    })
    .strict()
    .refine(
      (q) => Date.parse(q.validUntil) > Date.now() + 3600000,
      'A quote must stay valid for at least an hour',
    ),
  z
    .object({
      action: z.enum(['answer', 'start', 'update', 'deliver', 'close']),
      commandId: z.uuid(),
      ...requestRef,
      customerNote: synthetic(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('note'),
      commandId: z.uuid(),
      ...requestRef,
      internalNote: synthetic(1000),
    })
    .strict(),
]);
export const staffCatalogueInput = z
  .object({
    commandId: z.uuid(),
    serviceKey: z.string().regex(/^[a-z][a-z0-9-]{2,59}$/),
    expectedVersion: z.number().int().min(0).max(2147483646),
    title: plain(3, 120),
    summary: plain(10, 400),
    included: z.array(plain(3, 200)).min(1).max(12),
    excluded: z.array(plain(3, 200)).min(1).max(12),
    regions: z.array(plain(2, 80)).min(1).max(12),
    quoteBasis: z.enum(['per_day', 'per_visit', 'per_item', 'fixed_scope']),
    active: z.boolean(),
  })
  .strict();
export const staffListQuery = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

// Staff side of paid-service requests. Authority is the existing protected staff authority (owner or admin with a
// fresh authenticator check in an operator workspace); the database repeats the check on the live session.
export class CustomerServiceStaffService {
  constructor(private pool: DatabasePool) {}
  async list(ctx: RequestContext, input: unknown = {}) {
    const q = staffListQuery.parse(input);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (
          await db.query('SELECT app.service_request_staff_list($1,$2) result', [
            q.after ?? null,
            q.pageSize,
          ])
        ).rows[0].result,
    );
  }
  async view(ctx: RequestContext, requestId: string) {
    const id = z.uuid().parse(requestId);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (await db.query('SELECT app.service_request_staff_view($1) result', [id])).rows[0].result,
    );
  }
  async command(ctx: RequestContext, input: unknown) {
    const { action, commandId, ...payload } = staffServiceCommandInput.parse(input);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (
          await db.query('SELECT app.service_request_staff_command($1,$2,$3) result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
    );
  }
  async catalogue(ctx: RequestContext) {
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (await db.query('SELECT app.service_catalogue_staff_list() result')).rows[0].result,
    );
  }
  async reviseCatalogue(ctx: RequestContext, input: unknown) {
    const { commandId, ...payload } = staffCatalogueInput.parse(input);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (
          await db.query('SELECT app.service_catalogue_staff_command($1,$2) result', [
            commandId,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
    );
  }
}
