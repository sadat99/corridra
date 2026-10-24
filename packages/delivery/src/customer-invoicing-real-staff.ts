import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';

const control = /[\u0000-\u001f\u007f]/u;
// Text that staff write on a real document is plain: no links, addresses or control characters. The database repeats this.
const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) => !control.test(v) && !/(:\/\/|@|www\.)/.test(v),
      'Plain text only, no links or addresses',
    );
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amount = z.string().regex(/^[1-9][0-9]{0,11}$/);
const invoiceRef = { invoiceId: z.uuid(), expectedPosition: z.number().int().min(0).max(1000) };
export const realInvoicingStaffCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('prepare_invoice'),
      commandId: z.uuid(),
      subscriptionId: z.uuid(),
      periodStart: day,
      dueOn: day,
      billToName: plain(2, 120),
      billToAddress: plain(5, 300),
    })
    .strict(),
  z
    .object({
      action: z.literal('prepare_credit'),
      commandId: z.uuid(),
      ...invoiceRef,
      amountMinor: amount,
      reason: plain(10, 500),
    })
    .strict(),
  z
    .object({
      action: z.literal('decide'),
      commandId: z.uuid(),
      proposalId: z.uuid(),
      decision: z.enum(['approve', 'reject']),
      reason: plain(3, 500).optional(),
    })
    .strict()
    .refine(
      (v) => v.decision === 'approve' || v.reason !== undefined,
      'A rejection needs a reason',
    ),
  z
    .object({
      action: z.literal('payment'),
      commandId: z.uuid(),
      ...invoiceRef,
      amountMinor: amount,
      receivedOn: day,
      method: z.enum(['bank_transfer', 'cash', 'other']),
      reference: plain(2, 120),
    })
    .strict(),
]);
export const realInvoicingStaffListQuery = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export const realInvoicingStaffOffMessage = 'Invoices are not switched on for real workspaces yet';

// Staff side of real invoicing. Authority is the existing protected staff authority (owner or admin with a fresh
// authenticator check in a real operator workspace); the database repeats the check on the live session and also
// refuses a sample operator workspace and a closed control. A 55000 answer means the control is closed.
export class CustomerRealInvoicingStaffService {
  constructor(private pool: DatabasePool) {}
  private async read<T>(ctx: RequestContext, work: (db: DatabaseClient) => Promise<T>) {
    try {
      return await withTenant(this.pool, ctx, 'delivery.share', async ({ db }) => work(db));
    } catch (error) {
      if ((error as { code?: string }).code === '55000')
        throw new DomainError(realInvoicingStaffOffMessage, 503);
      throw error;
    }
  }
  async pending(ctx: RequestContext) {
    return this.read(
      ctx,
      async (db) =>
        (await db.query('SELECT app.real_invoicing_staff_pending() result')).rows[0].result,
    );
  }
  async list(ctx: RequestContext, input: unknown = {}) {
    const q = realInvoicingStaffListQuery.parse(input);
    return this.read(
      ctx,
      async (db) =>
        (
          await db.query('SELECT app.real_invoicing_staff_list($1,$2) result', [
            q.after ?? null,
            q.pageSize,
          ])
        ).rows[0].result,
    );
  }
  async view(ctx: RequestContext, invoiceId: string) {
    const id = z.uuid().parse(invoiceId);
    return this.read(
      ctx,
      async (db) =>
        (await db.query('SELECT app.real_invoicing_staff_view($1) result', [id])).rows[0].result,
    );
  }
  async command(ctx: RequestContext, input: unknown) {
    const { action, commandId, ...payload } = realInvoicingStaffCommandInput.parse(input);
    return this.read(
      ctx,
      async (db) =>
        (
          await db.query('SELECT app.real_invoicing_staff_command($1,$2,$3) result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
    );
  }
}
