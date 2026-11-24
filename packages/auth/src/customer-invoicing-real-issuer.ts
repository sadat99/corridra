import { z } from 'zod';
import { DomainError, stepUpRequired } from '@corridra/domain';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';

// ADR-092 (unit B8): the Invoice issuer screen. The owner of the real staff workspace types the details printed on every
// real invoice (legal name, UEN, address, GST status and number, payment instructions, finance contact label) and saves
// them behind an authenticator check. A save writes one new append-only version of the supplier record of ADR-064; the
// fields typed here are no longer marked made up, so the real-invoice refusal (D3) lifts once nothing made up is left.
// This opens nothing: real invoices still need their own control and switch, and no payment exists.
export function invoiceIssuerEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CORRIDRA_INVOICE_ISSUER === 'true';
}
export const invoiceIssuerOwnerMessage = 'Only the workspace owner can open the issuer details';
export const invoiceIssuerNotInstalledMessage = 'The invoice module is not installed here yet';
export const invoiceIssuerChangedMessage =
  'The issuer details changed after you opened them. Load the latest details and try again.';
export const invoiceIssuerInvalidMessage =
  'Some issuer details were not accepted. Use plain words, with no made-up value, link or email address.';

// The same rule as the supplier record (ADR-064): plain text, no control characters, no link or address. A value that
// still says "(madeup)" is refused, so a placeholder can never be saved as a real detail.
const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) =>
        !/[\u0000-\u001f\u007f]/u.test(v) && !/(:\/\/|@|www\.)/.test(v) && !/\(madeup\)/i.test(v),
      'Plain text only',
    );
// The values the install step seeds (ADR-064). They are refused even with the "(madeup)" text taken off.
const seeded = {
  uen: '202600000A',
  gstRegistrationNo: 'M9-0000000-0',
  financeLabel: 'sadat fpa',
  account: '000-000000-0',
};
export const issuerDetailsInput = z
  .object({
    commandId: z.uuid(),
    // The version the owner was looking at. A save against an older version is refused.
    expectedVersion: z.number().int().min(1).max(999999999),
    legalName: plain(2, 120),
    address: plain(5, 300),
    uen: plain(3, 60),
    gstRegistered: z.boolean(),
    gstRegistrationNo: plain(3, 60).nullable(),
    paymentInstructions: plain(5, 400),
    financeLabel: plain(2, 120),
  })
  .strict()
  .refine(
    (v) =>
      v.uen.toUpperCase() !== seeded.uen &&
      (v.gstRegistrationNo ?? '').toUpperCase() !== seeded.gstRegistrationNo &&
      v.financeLabel.toLowerCase() !== seeded.financeLabel &&
      !v.paymentInstructions.includes(seeded.account),
    'A seeded placeholder value is not a real detail',
  )
  .refine(
    (v) => (v.gstRegistered ? v.gstRegistrationNo !== null : v.gstRegistrationNo === null),
    'A GST registered issuer needs its number; an unregistered one has none',
  );

export type IssuerDetails = {
  legalName: string | null;
  address: string | null;
  uen: string | null;
  gstRegistered: boolean | null;
  gstRegistrationNo: string | null;
  paymentInstructions: string | null;
  financeLabel: string | null;
};
export type IssuerView = {
  version: number;
  // True when a UEN exists and no field is made up.
  complete: boolean;
  enteredByOwner: boolean;
  savedAt: string;
  // Database names of the fields that are still made up. Their values are never sent.
  madeupFields: string[];
  details: IssuerDetails;
  // Set by the install step, shown for information only.
  fixed: { country: string; taxLabel: string; gstRateBps: number; paymentTermsDays: number };
  realInvoicesOpen: boolean;
  synthetic: false;
};
export type IssuerSaved = {
  state: 'saved' | 'unchanged';
  version: number;
  complete: boolean;
  // JSON names of the fields that changed. Never a value.
  changedFields: string[];
  madeupFields: string[];
  commandId: string;
  synthetic: false;
};

// Rebuilt from fixed text and the database code only: a database error can quote the failing row.
function refusal(error: unknown): unknown {
  if (error instanceof DomainError) return error;
  const code = (error as { code?: string } | null)?.code;
  if (code === '42501') return new DomainError(invoiceIssuerOwnerMessage, 403);
  if (code === 'CR401') return stepUpRequired();
  if (code === 'CR409')
    return new DomainError(invoiceIssuerChangedMessage, 409, 'ISSUER_DETAILS_CHANGED');
  if (code === '23505')
    return new DomainError('This save was already sent with other details. Save again.', 409);
  if (code === '23514') return new DomainError(invoiceIssuerInvalidMessage, 400);
  // 55000: no supplier record yet. 42883, 42P01, 3F000: the module (or this part of it) is not installed.
  if (code && ['55000', '42883', '42P01', '3F000'].includes(code))
    return new DomainError(invoiceIssuerNotInstalledMessage, 503);
  return error;
}

// Server-only. The staff session decides who is acting; the database repeats every check on the live session: the owner
// role, a real staff workspace and, for a save, an authenticator check from the last five minutes.
export class InvoiceIssuerService {
  constructor(private pool: DatabasePool) {}
  private async run<T>(
    ctx: RequestContext,
    permission: 'delivery.read' | 'delivery.share',
    work: (db: DatabaseClient) => Promise<T>,
  ) {
    try {
      return await withTenant(this.pool, ctx, permission, async ({ db, role }) => {
        if (role !== 'owner') throw new DomainError(invoiceIssuerOwnerMessage, 403);
        return work(db);
      });
    } catch (error) {
      throw refusal(error);
    }
  }
  /** The version in force, with every made-up value left out. Needs the owner; no fresh check. */
  async view(ctx: RequestContext): Promise<IssuerView> {
    return this.run(
      ctx,
      'delivery.read',
      async (db) =>
        (await db.query<{ result: IssuerView }>('SELECT app.real_invoicing_issuer_view() result'))
          .rows[0].result,
    );
  }
  /** Writes the typed details as one new version. Needs the owner and a fresh authenticator check. */
  async save(ctx: RequestContext, input: unknown): Promise<IssuerSaved> {
    const parsed = issuerDetailsInput.safeParse(input);
    if (!parsed.success) throw new DomainError(invoiceIssuerInvalidMessage, 400);
    const { commandId, ...details } = parsed.data;
    return this.run(
      ctx,
      'delivery.share',
      async (db) =>
        (
          await db.query<{ result: IssuerSaved }>(
            'SELECT app.real_invoicing_issuer_save($1,$2) result',
            [commandId, JSON.stringify(details)],
          )
        ).rows[0].result,
    );
  }
}
