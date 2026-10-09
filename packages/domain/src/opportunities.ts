import { z } from 'zod';
import { DomainError } from './index';
export const currencies = { BDT: 2, EUR: 2, USD: 2, GBP: 2, JPY: 0 } as const;
export const currency = z.enum(['BDT', 'EUR', 'USD', 'GBP', 'JPY']);
export const opportunityStatus = z.enum([
  'LEAD',
  'QUALIFIED_OPPORTUNITY',
  'PROPOSAL',
  'COMMITMENT',
  'CONTRACT',
  'INVOICE',
  'CASH_COLLECTED',
  'RECURRING_REVENUE',
  'LOST',
]);
export type OpportunityStatus = z.infer<typeof opportunityStatus>;
export const opportunityTransitions: Record<OpportunityStatus, readonly OpportunityStatus[]> = {
  LEAD: ['QUALIFIED_OPPORTUNITY', 'LOST'],
  QUALIFIED_OPPORTUNITY: ['PROPOSAL', 'LOST'],
  PROPOSAL: ['COMMITMENT', 'LOST'],
  COMMITMENT: ['CONTRACT', 'LOST'],
  CONTRACT: ['INVOICE', 'LOST'],
  INVOICE: ['CASH_COLLECTED', 'LOST'],
  CASH_COLLECTED: ['RECURRING_REVENUE'],
  RECURRING_REVENUE: [],
  LOST: [],
};
export function assertOpportunityTransition(from: OpportunityStatus, to: OpportunityStatus) {
  if (!opportunityTransitions[from].includes(to))
    throw new DomainError('Invalid opportunity transition', 409);
}
export const recordKind = z.enum([
  'RFQ',
  'SAMPLE',
  'PROPOSAL',
  'COMMITMENT',
  'CONTRACT',
  'INVOICE',
  'CASH_RECEIPT',
  'REPEAT_ORDER',
]);
export const minorUnits = z
  .string()
  .regex(/^[1-9][0-9]{0,17}$/, 'Enter positive integer minor units');
const reason = z.string().trim().min(3).max(500);
const date = z.iso
  .datetime({ offset: true })
  .refine((v) => Date.parse(v) <= Date.now(), 'Record an observed date, not a future date');
const base = { commandId: z.uuid(), reason };
const owned = {
  ownerId: z.uuid(),
  nextAction: z.string().trim().min(3).max(300),
  dueAt: z.iso.datetime({ offset: true }),
};
export const commercialCommand = z.discriminatedUnion('action', [
  z.object({
    ...base,
    ...owned,
    action: z.literal('create'),
    meetingId: z.uuid(),
    title: z.string().trim().min(3).max(160),
    attribution: z.string().trim().min(3).max(1000),
  }),
  z.object({
    ...base,
    ...owned,
    action: z.literal('transition'),
    id: z.uuid(),
    version: z.int().positive(),
    status: opportunityStatus,
    lossReason: z.string().trim().min(3).max(500).optional(),
  }),
  z.object({
    ...base,
    ...owned,
    action: z.literal('followup'),
    id: z.uuid(),
    version: z.int().positive(),
  }),
  z.object({
    ...base,
    action: z.literal('record'),
    id: z.uuid(),
    kind: recordKind,
    sourceId: z.uuid(),
    evidenceId: z.uuid().optional(),
    occurredAt: date,
    summary: z.string().trim().min(3).max(1000),
    externalReference: z.string().trim().min(3).max(200),
    parentId: z.uuid().optional(),
    priorReceiptId: z.uuid().optional(),
    amountMinor: minorUnits.optional(),
    currency: currency.optional(),
  }),
  z.object({
    ...base,
    action: z.literal('reverse'),
    recordId: z.uuid(),
    sourceId: z.uuid(),
    occurredAt: date,
  }),
  z.object({
    ...base,
    action: z.literal('confirm'),
    recordId: z.uuid(),
    sourceId: z.uuid(),
    occurredAt: date,
    basis: z.string().trim().min(3).max(1000),
  }),
  z.object({ ...base, action: z.literal('rebuild') }),
]);
export function formatMoney(amount: string, code: keyof typeof currencies) {
  const value = BigInt(amount),
    negative = value < BigInt(0),
    abs = negative ? -value : value,
    exponent = currencies[code],
    scale = BigInt(10) ** BigInt(exponent);
  return `${code} ${negative ? '-' : ''}${abs / scale}${exponent ? '.' + String(abs % scale).padStart(exponent, '0') : ''}`;
}
export function parseMoney(value: string, code: keyof typeof currencies) {
  const exponent = currencies[code];
  if (
    !new RegExp(`^[0-9]+${exponent ? '(?:\\.[0-9]{1,' + exponent + '})?' : ''}$`).test(value.trim())
  )
    throw new DomainError('Enter an amount with the currency’s supported decimal places', 400);
  const [whole, fraction = ''] = value.trim().split('.');
  return minorUnits.parse(
    (
      BigInt(whole) * BigInt(10) ** BigInt(exponent) +
      BigInt(fraction.padEnd(exponent, '0') || '0')
    ).toString(),
  );
}
