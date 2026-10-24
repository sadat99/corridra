import { z } from 'zod';
import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';

const control = /[\u0000-\u001f\u007f]/u;
// Text that staff write on a payment or credit note is invented. The database repeats this rule.
const synthetic = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
    .refine((v) => !control.test(v), 'Control characters are not allowed');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Whole minor units as digits, in the invoice currency.
const amount = z.string().regex(/^[1-9][0-9]{0,11}$/);
const invoiceRef = { invoiceId: z.uuid(), expectedPosition: z.number().int().min(0).max(1000) };
export const staffInvoicingCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('issue'),
      commandId: z.uuid(),
      subscriptionId: z.uuid(),
      periodStart: day,
      planFeeMinor: z.string().regex(/^[1-9][0-9]{0,10}$/),
      // Null when the plan says tax is to be confirmed; digits (zero allowed) otherwise.
      taxMinor: z
        .string()
        .regex(/^(0|[1-9][0-9]{0,10})$/)
        .nullable(),
      dueOn: day,
    })
    .strict(),
  z
    .object({
      action: z.literal('payment'),
      commandId: z.uuid(),
      ...invoiceRef,
      amountMinor: amount,
      receivedOn: day,
      method: z.enum(['bank_transfer', 'cash', 'other']),
      reference: synthetic(120),
    })
    .strict(),
  z
    .object({
      action: z.literal('credit'),
      commandId: z.uuid(),
      ...invoiceRef,
      amountMinor: amount,
      reason: synthetic(500),
    })
    .strict(),
]);
export const staffInvoicingListQuery = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

// Staff side of sample invoicing. Authority is the existing protected staff authority (owner or admin with a fresh
// authenticator check in an operator workspace); the database repeats the check on the live session.
export class CustomerInvoicingStaffService {
  constructor(private pool: DatabasePool) {}
  async pending(ctx: RequestContext) {
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (await db.query('SELECT app.invoicing_staff_pending() result')).rows[0].result,
    );
  }
  async list(ctx: RequestContext, input: unknown = {}) {
    const q = staffInvoicingListQuery.parse(input);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (
          await db.query('SELECT app.invoicing_staff_list($1,$2) result', [
            q.after ?? null,
            q.pageSize,
          ])
        ).rows[0].result,
    );
  }
  async view(ctx: RequestContext, invoiceId: string) {
    const id = z.uuid().parse(invoiceId);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (await db.query('SELECT app.invoicing_staff_view($1) result', [id])).rows[0].result,
    );
  }
  async command(ctx: RequestContext, input: unknown) {
    const { action, commandId, ...payload } = staffInvoicingCommandInput.parse(input);
    return withTenant(
      this.pool,
      ctx,
      'delivery.share',
      async ({ db }) =>
        (
          await db.query('SELECT app.invoicing_staff_command($1,$2,$3) result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
    );
  }
}
