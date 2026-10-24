import { z } from 'zod';
import { customerBillingEnabled, type BillingTaxTreatment } from './customer-billing';
import { CustomerSessionBoundary } from './customer-session';

// ADR-061: sample invoices, payment records and credit notes. Off unless the owner sets the switch, it needs the
// billing switch too, and then only for sample workspaces: the database refuses any other workspace. Customers can
// read only; there is no customer command, no payment and no processor.
export function customerInvoicingEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerBillingEnabled(env) && env.CORRIDRA_CUSTOMER_INVOICING_ENABLED === 'true';
}
export const customerInvoicingWorkspaceQuery = z.object({ workspaceId: z.uuid() }).strict();

export type InvoiceStatus = 'unpaid' | 'partly_paid' | 'paid' | 'credited' | 'settled';
export type InvoicePayment = {
  seq: number;
  // Exact whole minor units as digits, in the invoice currency. Never converted.
  amountMinor: string;
  receivedOn: string;
  method: 'bank_transfer' | 'cash' | 'other';
};
export type InvoiceCredit = {
  seq: number;
  number: string;
  amountMinor: string;
  issuedOn: string;
  reason: string;
};
export type Invoice = {
  id: string;
  number: string;
  subscriptionId: string;
  workspaceId: string;
  planKey: string;
  planVersion: number;
  planTitle: string;
  interval: 'month' | 'year';
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxTreatment: BillingTaxTreatment;
  planFeeMinor: string;
  // Null when the plan says tax is to be confirmed.
  taxMinor: string | null;
  totalMinor: string;
  paidMinor: string;
  creditedMinor: string;
  outstandingMinor: string;
  status: InvoiceStatus;
  overdue: boolean;
  payments: InvoicePayment[];
  credits: InvoiceCredit[];
  moneyDomain: 'B';
  label: string;
  synthetic: true;
};
export type InvoiceBalance = {
  currency: string;
  invoicedMinor: string;
  paidMinor: string;
  creditedMinor: string;
  outstandingMinor: string;
  overdueMinor: string;
};
export type InvoicingOverview = {
  workspaceId: string;
  canRead: boolean;
  invoicesExist: boolean;
  invoices: Invoice[];
  balances: InvoiceBalance[];
  paymentTaken: false;
  synthetic: true;
  expiresAt: string;
};

// Server-only: the current provider session decides who is acting; the workspace role comes from the database.
export class CustomerInvoicingService extends CustomerSessionBoundary {
  async overview(input: unknown, subject?: string, issuer?: string) {
    const q = customerInvoicingWorkspaceQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: InvoicingOverview }>(
            'SELECT customer.invoicing_overview($1) AS result',
            [q.workspaceId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
