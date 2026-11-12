import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerParticipantsEnabled } from './customer-participants';

export function customerProgrammeEconomicsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerParticipantsEnabled(env) && env.CORRIDRA_CUSTOMER_PROGRAMME_ECONOMICS_ENABLED === 'true'
  );
}
export const ledgerKinds = [
  'PARTICIPANT_FEE',
  'PARTICIPANT_PAYMENT',
  'ORGANISER_EXPENSE',
  'ORGANISER_OBLIGATION',
  'CORRIDRA_SERVICE_FEE',
] as const;
export type LedgerKind = (typeof ledgerKinds)[number];
export const costKinds = ['ORGANISER_EXPENSE', 'ORGANISER_OBLIGATION', 'CORRIDRA_SERVICE_FEE'];
const control = /[\u0000-\u001f\u007f]/u;
const description = z
  .string()
  .trim()
  .min(2)
  .max(300)
  .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
  .refine((v) => !control.test(v), 'Control characters are not allowed');
const day = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v &&
      v >= '2000-01-01' &&
      v <= '2100-01-01',
    'Enter a valid date',
  );
// Exact whole units as text. A JavaScript number cannot hold the full range without losing digits.
export const amountMinor = z.string().regex(/^[1-9][0-9]{0,17}$/, 'Enter a whole-unit amount');
export const newLedgerEntry = z
  .object({
    kind: z.enum(ledgerKinds),
    costBasis: z.enum(['PLANNED', 'ACTUAL']).nullable(),
    registrationId: z.uuid().nullable(),
    amountMinor,
    currency: z.string().regex(/^[A-Z]{3}$/),
    occurredOn: day,
    description,
  })
  .strict()
  .refine((v) => costKinds.includes(v.kind) === (v.costBasis !== null), {
    message: 'Costs are planned or actual; fees and payments are neither',
  })
  .refine((v) => v.kind.startsWith('PARTICIPANT_') === (v.registrationId !== null), {
    message: 'Fees and payments belong to one participant',
  })
  .refine(
    // A receipt cannot be dated after today. One day of slack covers time zones, SQL is exact.
    (v) =>
      v.kind !== 'PARTICIPANT_PAYMENT' ||
      v.occurredOn <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    { message: 'A payment cannot be dated in the future' },
  );
export const ledgerCorrection = z
  .object({ reverseOf: z.uuid(), occurredOn: day, description })
  .strict();
export const ledgerRecordInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    entry: z.union([newLedgerEntry, ledgerCorrection]),
    acknowledged: z.literal(true),
  })
  .strict();
export const ledgerScope = z.object({ workspaceId: z.uuid(), programmeId: z.uuid() }).strict();
export const ledgerListQuery = ledgerScope.extend({
  beforeSeq: z.coerce.number().int().min(1).max(2147483646).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type LedgerEntry = {
  id: string;
  seq: number;
  kind: LedgerKind;
  costBasis: 'PLANNED' | 'ACTUAL' | null;
  registrationId: string | null;
  registrationLabel: string | null;
  amountMinor: string;
  currency: string;
  exponent: number;
  occurredOn: string;
  description: string;
  reverseOf: string | null;
  reversedBy: string | null;
  provenance: 'ORGANISER_RECORDED';
  recordedAt: string;
};
export type LedgerRecordResult = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  commandId: string;
  replayed: boolean;
  entry: LedgerEntry;
};
export type LedgerListResult = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  entries: LedgerEntry[];
  nextBefore: number | null;
};
type Costs = { expenses: string; obligations: string; corridraServiceFees: string; total: string };
export type ProgrammeEconomics = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  provenance: 'ORGANISER_RECORDED';
  verified: false;
  collectsPayments: false;
  currencies: {
    currency: string;
    exponent: number;
    feesDue: string;
    paymentsRecorded: string;
    outstanding: string;
    plannedCosts: Costs;
    actualCosts: Costs;
    marginIfPlanned: string;
    marginOnActual: string;
    cashMargin: string;
  }[];
  participants: {
    registrationId: string;
    label: string;
    state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED';
    amounts: {
      currency: string;
      exponent: number;
      due: string;
      recorded: string;
      status: 'NO_FEE' | 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID';
    }[];
  }[];
  counts: { registered: number; active: number; withdrawnOrRemoved: number };
};
// U10c: a participant declares a payment ("I have paid"); the organiser acknowledges or does not accept it. A declaration is not
// proof of bank receipt and never changes a recorded or outstanding amount; only an acknowledgement writes a ledger entry.
const reference = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine((v) => !control.test(v), 'Control characters are not allowed');
export const paymentDeclareInput = z
  .object({
    commandId: z.uuid(),
    registrationId: z.uuid(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amountMinor,
    paidOn: day.refine((v) => v <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), {
      message: 'A payment cannot be dated in the future',
    }),
    payerReference: reference(120).nullable(),
    note: reference(500).nullable(),
  })
  .strict();
export const paymentOwnQuery = z.object({ registrationId: z.uuid() }).strict();
export const paymentDecideInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    declarationId: z.uuid(),
    decision: z.enum(['ACKNOWLEDGED', 'REJECTED']),
    reason: reference(300).min(10).nullable(),
    receivedAmountMinor: amountMinor.nullable(),
    receivedOn: day.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      v.decision === 'REJECTED'
        ? v.reason !== null && v.receivedAmountMinor === null && v.receivedOn === null
        : v.reason === null,
    { message: 'A rejection needs a reason; an acknowledgement carries none' },
  )
  .refine(
    (v) =>
      v.receivedOn === null ||
      v.receivedOn <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    { message: 'A payment cannot be dated in the future' },
  );
export type PaymentDeclaration = {
  id: string;
  registrationId: string;
  currency: string;
  exponent: number;
  amountMinor: string;
  paidOn: string;
  payerReference: string | null;
  note: string | null;
  declaredAt: string;
  status: 'AWAITING_REVIEW' | 'ACKNOWLEDGED' | 'REJECTED';
  reason: string | null;
  decidedAt: string | null;
  // What the organiser recorded when they acknowledged it. It can differ from the declared amount and date.
  acknowledgedAmountMinor: string | null;
  acknowledgedOn: string | null;
  verified: false;
  // Organiser view only.
  ledgerEntryId?: string | null;
  outstandingMinor?: string;
};
export type OwnPaymentDeclarations = {
  registrationId: string;
  programmeId: string;
  expiresAt: string;
  provenance: 'PARTICIPANT_DECLARED';
  verified: false;
  collectsPayments: false;
  declarations: PaymentDeclaration[];
};
export type PendingPaymentDeclarations = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  provenance: 'PARTICIPANT_DECLARED';
  verified: false;
  declarations: PaymentDeclaration[];
};
export type PaymentDeclareResult = {
  registrationId: string;
  expiresAt: string;
  commandId: string;
  replayed: boolean;
  declaration: PaymentDeclaration;
};
export type PaymentDecideResult = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  commandId: string;
  replayed: boolean;
  declaration: PaymentDeclaration;
  entry: LedgerEntry | null;
};
// U10d: a participant flags a question about their own fee or payment status; the organiser marks it resolved or declined.
// Record only: no amount, no free text, no ledger entry. It never changes a recorded or outstanding amount or a payment status.
export const feeDisputeReasons = [
  'AMOUNT_WRONG',
  'ALREADY_PAID',
  'NOT_ATTENDING',
  'OTHER',
] as const;
export type FeeDisputeReason = (typeof feeDisputeReasons)[number];
export const feeDisputeFileInput = z
  .object({
    commandId: z.uuid(),
    registrationId: z.uuid(),
    reason: z.enum(feeDisputeReasons),
  })
  .strict();
export const feeDisputeOwnQuery = z.object({ registrationId: z.uuid() }).strict();
export const feeDisputeDecideInput = z
  .object({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    disputeId: z.uuid(),
    outcome: z.enum(['RESOLVED', 'DECLINED']),
  })
  .strict();
export type FeeDispute = {
  id: string;
  registrationId: string;
  reason: FeeDisputeReason;
  filedAt: string;
  status: 'OPEN' | 'RESOLVED' | 'DECLINED';
  decidedAt: string | null;
};
export type OwnFeeDisputes = {
  registrationId: string;
  programmeId: string;
  expiresAt: string;
  recordOnly: true;
  collectsPayments: false;
  disputes: FeeDispute[];
};
export type OpenFeeDisputes = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  recordOnly: true;
  disputes: FeeDispute[];
};
export type FeeDisputeResult = {
  registrationId?: string;
  workspaceId?: string;
  programmeId?: string;
  expiresAt: string;
  commandId: string;
  replayed: boolean;
  recordOnly: true;
  dispute: FeeDispute;
};
export class CustomerProgrammeEconomicsService extends CustomerSessionBoundary {
  async summary(input: unknown, subject?: string, issuer?: string) {
    const q = ledgerScope.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: ProgrammeEconomics }>(
            'SELECT customer.programme_economics($1,$2) AS result',
            [q.workspaceId, q.programmeId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async list(input: unknown, subject?: string, issuer?: string) {
    const q = ledgerListQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: LedgerListResult }>(
            'SELECT customer.programme_ledger_list($1,$2,$3,$4) AS result',
            [q.workspaceId, q.programmeId, q.beforeSeq ?? null, q.pageSize],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async record(input: unknown, subject?: string, issuer?: string) {
    const { commandId, workspaceId, programmeId, entry, acknowledged } =
      ledgerRecordInput.parse(input);
    void acknowledged;
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: LedgerRecordResult }>(
            'SELECT customer.programme_ledger_record($1,$2,$3,$4) AS result',
            [commandId, workspaceId, programmeId, JSON.stringify(entry)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async declarePayment(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...payload } = paymentDeclareInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: PaymentDeclareResult }>(
            'SELECT customer.declare_programme_payment($1,$2) AS result',
            [commandId, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async ownPaymentDeclarations(input: unknown, subject?: string, issuer?: string) {
    const q = paymentOwnQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: OwnPaymentDeclarations }>(
            'SELECT customer.own_programme_payment_declarations($1) AS result',
            [q.registrationId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async pendingPaymentDeclarations(input: unknown, subject?: string, issuer?: string) {
    const q = ledgerScope.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: PendingPaymentDeclarations }>(
            'SELECT customer.programme_payment_declarations_pending($1,$2) AS result',
            [q.workspaceId, q.programmeId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async decidePayment(input: unknown, subject?: string, issuer?: string) {
    const { commandId, workspaceId, programmeId, ...payload } = paymentDecideInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: PaymentDecideResult }>(
            'SELECT customer.decide_programme_payment($1,$2,$3,$4) AS result',
            [commandId, workspaceId, programmeId, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async fileFeeDispute(input: unknown, subject?: string, issuer?: string) {
    const { commandId, ...payload } = feeDisputeFileInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: FeeDisputeResult }>(
            'SELECT customer.file_programme_fee_dispute($1,$2) AS result',
            [commandId, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async ownFeeDisputes(input: unknown, subject?: string, issuer?: string) {
    const q = feeDisputeOwnQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: OwnFeeDisputes }>(
            'SELECT customer.own_programme_fee_disputes($1) AS result',
            [q.registrationId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async openFeeDisputes(input: unknown, subject?: string, issuer?: string) {
    const q = ledgerScope.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: OpenFeeDisputes }>(
            'SELECT customer.programme_fee_disputes_open($1,$2) AS result',
            [q.workspaceId, q.programmeId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async decideFeeDispute(input: unknown, subject?: string, issuer?: string) {
    const { commandId, workspaceId, programmeId, ...payload } = feeDisputeDecideInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: FeeDisputeResult }>(
            'SELECT customer.decide_programme_fee_dispute($1,$2,$3,$4) AS result',
            [commandId, workspaceId, programmeId, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
