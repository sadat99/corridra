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
// The shortest reason a payment reversal may carry: the credit note rule. The database holds the same number in
// customer_private.real_reversal_reason_min(), and the staff screen holds one matching constant.
export const REVERSAL_REASON_MIN = 10;
const invoiceRef = { invoiceId: z.uuid(), expectedPosition: z.number().int().min(0).max(1500) };
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
  // Recording a payment: the one-person command works only while the owner has recorded that a second person is not
  // required. Otherwise a payment is prepared by one person and approved by another with `decide`.
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
  z
    .object({
      action: z.literal('prepare_payment'),
      commandId: z.uuid(),
      ...invoiceRef,
      amountMinor: amount,
      receivedOn: day,
      method: z.enum(['bank_transfer', 'cash', 'other']),
      reference: plain(2, 120),
    })
    .strict(),
  // Reversing a payment entered in error: prepared with a reason, approved by a second person. The payment stays.
  z
    .object({
      action: z.literal('prepare_payment_reversal'),
      commandId: z.uuid(),
      ...invoiceRef,
      paymentSeq: z.number().int().min(1).max(500),
      reason: plain(REVERSAL_REASON_MIN, 500),
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
/**
 * On in the live production deployment with real data. Tests, previews and sample environments keep issuing
 * (madeup) documents exactly as before, so the payment simulation and its proofs stay available.
 */
export function madeupSupplierGuardOn(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === 'production' && env.DATA_ENVIRONMENT === 'real';
}
// Commands that put a new real document (invoice or credit note) in front of a customer.
const preparing = (action: string) => action === 'prepare_invoice' || action === 'prepare_credit';
/**
 * Throws (409, MADEUP_SUPPLIER_DETAILS) when the command would issue a real document while any supplier detail
 * is made up. Runs in the command's own staff transaction, so the details cannot change in between.
 *
 * Preparing is checked before the command. Approving is checked after it, on what the command returned: an approval
 * that issued an invoice or credit note throws and the whole command rolls back, while approving a payment or the
 * reversal of one puts no document in front of a customer and passes. Running the command first also means a retry
 * whose first answer was lost replays the recorded result instead of being refused for a payment that exists.
 */
export async function refuseMadeupIssue(
  db: Pick<DatabaseClient, 'query'>,
  action: string,
  payload: Record<string, unknown>,
  result?: { kind?: string } | null,
) {
  const approved = action === 'decide' && payload.decision === 'approve';
  const before = result === undefined && preparing(action);
  const after =
    result !== undefined && approved && (result?.kind === 'invoice' || result?.kind === 'credit');
  if (!before && !after) return;
  const pending = (await db.query('SELECT app.real_invoicing_staff_pending() result')).rows[0]
    ?.result as { supplier?: SupplierDetails } | null;
  if (madeupSupplierFields(pending?.supplier).length)
    throw new DomainError(madeupSupplierMessage, 409, 'MADEUP_SUPPLIER_DETAILS');
}

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
      const guarded = this.guardMadeupSupplier();
      if (guarded) await refuseMadeupIssue(db, action, payload);
      const result = (
        await db.query('SELECT app.real_invoicing_staff_command($1,$2,$3) result', [
          commandId,
          action,
          JSON.stringify(payload),
        ])
      ).rows[0].result;
      // An approval that issued a document throws here and rolls the whole command back.
      if (guarded) await refuseMadeupIssue(db, action, payload, result);
      return result;
    });
  }
}
