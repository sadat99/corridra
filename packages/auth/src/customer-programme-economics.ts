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
  .min(11)
  .max(300)
  .regex(/^Synthetic /)
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
}
