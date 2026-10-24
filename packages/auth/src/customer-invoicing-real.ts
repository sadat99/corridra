import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { customerRealBillingEnabled, type BillingTaxTreatment } from './customer-billing';
import { CustomerSessionBoundary } from './customer-session';

// ADR-064: real invoices, payment records and credit notes (billing stage 2). Both the database control (opened by the
// owner-run install job) and this switch must be on, and real plans must be on too. Customers can read only; there is
// no customer command, no payment and no processor.
export function customerRealInvoicingEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerRealBillingEnabled(env) && env.CORRIDRA_CUSTOMER_REAL_INVOICING_ENABLED === 'true';
}
export const realInvoicingOffMessage = 'Invoices are not switched on for real workspaces yet';
export const realInvoicingWorkspaceQuery = z.object({ workspaceId: z.uuid() }).strict();

export type RealInvoiceStatus = 'unpaid' | 'partly_paid' | 'paid' | 'credited' | 'settled';
export type RealInvoice = {
  id: string;
  number: string;
  // "Tax Invoice" when the supplier was GST registered at issue, otherwise "Invoice".
  title: 'Tax Invoice' | 'Invoice';
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
  gstRegistered: boolean;
  taxLabel: string;
  // Basis points; null when no tax is charged.
  taxRateBps: number | null;
  // Exact whole minor units as digits, in `currency`. Never converted.
  planFeeMinor: string;
  taxMinor: string;
  amountExcludingTaxMinor: string;
  totalMinor: string;
  paidMinor: string;
  creditedMinor: string;
  outstandingMinor: string;
  status: RealInvoiceStatus;
  overdue: boolean;
  payments: { seq: number; amountMinor: string; receivedOn: string; method: string }[];
  credits: { seq: number; number: string; amountMinor: string; issuedOn: string; reason: string }[];
  supplier: {
    legalName: string;
    address: string;
    country: string;
    uen: string | null;
    gstRegistrationNo: string | null;
  };
  billTo: { name: string; address: string };
  paymentInstructions: string;
  // Fields of the supplier details that were made up when this was issued. Empty once the owner supplies real values.
  madeupFields: string[];
  label: string | null;
  moneyDomain: 'B';
  synthetic: false;
};
export type RealInvoicingOverview = {
  workspaceId: string;
  canRead: boolean;
  invoicesExist: boolean;
  invoices: RealInvoice[];
  balances: {
    currency: string;
    invoicedMinor: string;
    paidMinor: string;
    creditedMinor: string;
    outstandingMinor: string;
    overdueMinor: string;
  }[];
  paymentTaken: false;
  synthetic: false;
  expiresAt: string;
};

// Server-only: the current provider session decides who is acting; the workspace role comes from the database.
export class CustomerRealInvoicingService extends CustomerSessionBoundary {
  async overview(input: unknown, subject?: string, issuer?: string) {
    const q = realInvoicingWorkspaceQuery.parse(input);
    if (!customerRealInvoicingEnabled()) throw new DomainError(realInvoicingOffMessage, 503);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: RealInvoicingOverview }>(
            'SELECT customer.real_invoicing_overview($1) AS result',
            [q.workspaceId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
