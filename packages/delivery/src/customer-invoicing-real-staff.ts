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

// D3 (commercial readiness program): while any supplier detail printed on a real document is made up, a real invoice or
// credit note cannot be issued. Sample invoices and the (madeup) payment simulation are separate and stay available.
export const madeupSupplierMessage =
  'Real invoices are blocked until the company details are real. Replace every supplier detail marked (madeup), such as the UEN, GST number and bank account, then try again.';
export type SupplierDetails = Record<string, unknown> & { madeupFields?: unknown };
/** Names of the supplier details that are made up: listed as made up, or containing the text "(madeup)". */
export function madeupSupplierFields(supplier: SupplierDetails | null | undefined): string[] {
  if (!supplier) return [];
  const listed = Array.isArray(supplier.madeupFields) ? supplier.madeupFields.map(String) : [];
  const marked = Object.entries(supplier)
    .filter(([key, value]) => key !== 'madeupFields' && typeof value === 'string')
    .filter(([, value]) => /\(madeup\)/i.test(value as string))
    .map(([key]) => key);
  return [...new Set([...listed, ...marked])];
}
/** On in the live environment. Tests and sample environments keep issuing (madeup) documents as before. */
export function madeupSupplierGuardOn(env: NodeJS.ProcessEnv = process.env) {
  return env.DATA_ENVIRONMENT === 'real';
}
// Commands that put a new real document (invoice or credit note) in front of a customer.
const issuing = (action: string, payload: Record<string, unknown>) =>
  action === 'prepare_invoice' ||
  action === 'prepare_credit' ||
  (action === 'decide' && payload.decision === 'approve');

// Staff side of real invoicing. Authority is the existing protected staff authority (owner or admin with a fresh
// authenticator check in a real operator workspace); the database repeats the check on the live session and also
// refuses a sample operator workspace and a closed control. A 55000 answer means the control is closed.
export class CustomerRealInvoicingStaffService {
  constructor(
    private pool: DatabasePool,
    private guardMadeupSupplier: () => boolean = () => madeupSupplierGuardOn(),
  ) {}
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
    return this.read(ctx, async (db) => {
      if (this.guardMadeupSupplier() && issuing(action, payload)) {
        // Same transaction and staff check as the command itself, so the details cannot change in between.
        const pending = (await db.query('SELECT app.real_invoicing_staff_pending() result')).rows[0]
          .result as { supplier?: SupplierDetails } | null;
        if (madeupSupplierFields(pending?.supplier).length)
          throw new DomainError(madeupSupplierMessage, 409, 'MADEUP_SUPPLIER_DETAILS');
      }
      return (
        await db.query('SELECT app.real_invoicing_staff_command($1,$2,$3) result', [
          commandId,
          action,
          JSON.stringify(payload),
        ])
      ).rows[0].result;
    });
  }
}
