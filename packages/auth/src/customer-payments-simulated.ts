import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerRealInvoicingEnabled } from './customer-invoicing-real';
import { CustomerSessionBoundary } from './customer-session';

// ADR-065: the simulated payment provider "Corridra Pay (madeup)" for real invoices (billing stage 3). Real invoices must
// be on, this switch must be on, and the database control (opened by the owner-run install job) must be open. Nothing
// is collected, no network is touched, and a simulated attempt never changes an invoice.
export function customerSimulatedPaymentsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerRealInvoicingEnabled(env) && env.CORRIDRA_CUSTOMER_SIMULATED_PAYMENTS_ENABLED === 'true'
  );
}
export const simulatedPaymentsOffMessage = 'The simulated payment flow is not switched on yet';
export const simulatedPaymentsWorkspaceQuery = z.object({ workspaceId: z.uuid() }).strict();
export const simulatedPaymentCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      invoiceId: z.uuid(),
      amountMinor: z.string().regex(/^[1-9][0-9]{0,11}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('complete'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      attemptId: z.uuid(),
      outcome: z.enum(['succeeded', 'declined']),
    })
    .strict(),
]);

export type SimulatedPaymentState = 'started' | 'expired' | 'succeeded' | 'declined';
export type SimulatedPayment = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  workspaceId: string;
  workspaceName?: string;
  amountMinor: string;
  currency: string;
  state: SimulatedPaymentState;
  // Always ends with "(madeup)".
  providerRef: string;
  providerName: 'Corridra Pay (madeup)';
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  refundedMinor: string;
  refundableMinor: string;
  refundOpenUntil: string | null;
  refunds: { seq: number; amountMinor: string; reason: string; recordedAt: string }[];
  simulated: true;
  madeup: true;
  moneyMoves: false;
  moneyDomain: 'B';
};
export type SimulatedPaymentsOverview = {
  workspaceId: string;
  canPay: boolean;
  provider: {
    name: 'Corridra Pay (madeup)';
    madeup: true;
    refundWindowDays: number;
    refundPolicy: string;
  };
  payable: { invoiceId: string; number: string; currency: string; outstandingMinor: string }[];
  attempts: SimulatedPayment[];
  simulated: true;
  moneyMoves: false;
  paymentTaken: false;
  synthetic: false;
  expiresAt: string;
};

// Server-only: the current provider session decides who is acting; the workspace role comes from the database.
export class CustomerSimulatedPaymentsService extends CustomerSessionBoundary {
  async overview(input: unknown, subject?: string, issuer?: string) {
    const q = simulatedPaymentsWorkspaceQuery.parse(input);
    if (!customerSimulatedPaymentsEnabled())
      throw new DomainError(simulatedPaymentsOffMessage, 503);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: SimulatedPaymentsOverview }>(
            'SELECT customer.simulated_payments_overview($1) AS result',
            [q.workspaceId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async command(input: unknown, subject?: string, issuer?: string) {
    const { action, commandId, ...payload } = simulatedPaymentCommandInput.parse(input);
    if (!customerSimulatedPaymentsEnabled())
      throw new DomainError(simulatedPaymentsOffMessage, 503);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: { attempt: SimulatedPayment } }>(
            'SELECT customer.simulated_payment_command($1,$2,$3) AS result',
            [commandId, action, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
