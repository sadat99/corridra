import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { displayMoney } from '@corridra/domain/locale';
import type {
  BillingEntitlement,
  BillingOverview,
  BillingPlan,
  BillingPlans,
  SubscriptionStatus,
  SubscriptionSummary,
  SubscriptionTimelineEntry,
} from '@corridra/auth/customer-billing';
import type {
  Invoice,
  InvoiceBalance,
  InvoiceStatus,
  InvoicingOverview,
} from '@corridra/auth/customer-invoicing';
import type {
  RealInvoice,
  RealInvoiceStatus,
  RealInvoicingOverview,
} from '@corridra/auth/customer-invoicing-real';
import type {
  SimulatedPayment,
  SimulatedPaymentsOverview,
} from '@corridra/auth/customer-payments-simulated';
import {
  dateTimeText,
  dayText,
  unconfirmed,
  type Outcome,
  type Scope,
} from '../service-requests/service-request-client';

export type {
  BillingEntitlement,
  BillingOverview,
  BillingPlan,
  BillingPlans,
  SubscriptionStatus,
  SubscriptionSummary,
  SubscriptionTimelineEntry,
  Outcome,
  Scope,
};
export { dateTimeText, dayText, unconfirmed };

const endpoint = '/api/customer-billing';
// Identity comes from the server session. These headers only let the server refuse a switched account.
export async function callBillingApi<T>(
  scope: Scope,
  query: Record<string, string> | null,
  body: Record<string, unknown> | null,
  check: (value: unknown) => boolean,
  signal?: AbortSignal,
  path: string = endpoint,
): Promise<Outcome<T>> {
  try {
    const response = await fetch(
      path + (query ? '?' + new URLSearchParams(query).toString() : ''),
      {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'x-corridra-customer-subject': scope.subject,
          'x-corridra-customer-issuer': scope.issuer,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal,
      },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const data: unknown = await response.json();
    return check(data) ? { ok: true, data: data as T } : { ok: false, status: 'malformed' };
  } catch {
    return { ok: false, status: 'network' };
  }
}

// Plain wording for every failure. The server never explains which rule fired, so neither do we.
export function problemText(status: number | 'network' | 'malformed', doing: string): string {
  if (status === 401 || status === 403)
    return 'You no longer have access here, or your sign-in ended. Return to your account and try again.';
  if (status === 409)
    return 'That could not be saved because something has changed, or there is already an open plan request here. Reload and check.';
  if (status === 400) return 'That request could not be accepted. Reload the page and try again.';
  if (status === 503) return 'Plans are not switched on here.';
  return 'Could not ' + doing + '. Check your connection and try again.';
}

export const statusLabel: Record<
  SubscriptionStatus,
  { text: string; tone: 'neutral' | 'positive' | 'caution' | 'critical' | 'info' | 'unknown' }
> = {
  requested: { text: 'Waiting for the Corridra team', tone: 'info' },
  active: { text: 'Active', tone: 'positive' },
  cancel_scheduled: { text: 'Ends at the end of this period', tone: 'caution' },
  declined: { text: 'Request declined', tone: 'unknown' },
  withdrawn: { text: 'Request withdrawn', tone: 'unknown' },
  ended: { text: 'Ended', tone: 'unknown' },
};
export const kindText: Record<string, string> = {
  requested: 'You asked for this plan',
  activated: 'The plan started',
  renewed: 'The plan was renewed',
  declined: 'The request was declined',
  withdrawn: 'Request withdrawn',
  cancel_requested: 'Cancellation scheduled for the end of the period',
  cancel_withdrawn: 'Cancellation taken back',
  ended: 'The plan ended',
};
export const endReasonText: Record<string, string> = {
  ended_by_team: 'Ended by the Corridra team',
  replaced: 'Replaced by another plan',
  period_elapsed: 'The cancelled period ran out',
};
export const taxText: Record<string, string> = {
  price_excludes_tax: 'Price excludes tax',
  price_includes_tax: 'Price includes tax',
  tax_to_be_confirmed: 'Tax to be confirmed',
};
export const intervalText: Record<string, string> = { month: 'per month', year: 'per year' };

export function money(minor: string, currency: string) {
  try {
    return displayMoney(minor, currency);
  } catch {
    return minor + ' ' + currency;
  }
}
export function priceText(plan: { priceMinor: string; currency: string; interval: string }) {
  return plan.priceMinor === '0'
    ? 'Free'
    : money(plan.priceMinor, plan.currency) + ' ' + intervalText[plan.interval];
}
// What an entitlement grants, in one plain phrase.
export function grantText(e: BillingEntitlement) {
  if (e.mode === 'limit') return e.limit === 0 ? 'None' : 'Up to ' + e.limit;
  if (e.mode === 'unlimited') return 'No limit';
  return e.mode === 'included' ? 'Included' : 'Not included';
}

function isPlan(p: BillingPlan) {
  return (
    !!p &&
    typeof p.key === 'string' &&
    typeof p.digest === 'string' &&
    typeof p.priceMinor === 'string' &&
    Array.isArray(p.included) &&
    Array.isArray(p.excluded) &&
    Array.isArray(p.entitlements)
  );
}
export function validPlans(value: unknown): value is BillingPlans {
  const v = value as BillingPlans | null;
  return (
    !!v &&
    customerProvenanceAllowed(v.synthetic) &&
    typeof v.workspaceId === 'string' &&
    typeof v.canRequest === 'boolean' &&
    v.paymentTaken === false &&
    Array.isArray(v.plans) &&
    v.plans.every(isPlan) &&
    Number.isFinite(Date.parse(v.expiresAt))
  );
}
export function validOverview(value: unknown): value is BillingOverview {
  const v = value as BillingOverview | null;
  return (
    !!v &&
    customerProvenanceAllowed(v.synthetic) &&
    typeof v.workspaceId === 'string' &&
    typeof v.canAct === 'boolean' &&
    v.paymentTaken === false &&
    Array.isArray(v.entitlements) &&
    Array.isArray(v.actions) &&
    Array.isArray(v.subscriptions) &&
    v.subscriptions.every((s) => typeof s.id === 'string' && Array.isArray(s.timeline)) &&
    Number.isFinite(Date.parse(v.expiresAt))
  );
}

// Sample invoices (ADR-061) are read through the same endpoint with their own scope.
export type { Invoice, InvoiceBalance, InvoiceStatus, InvoicingOverview };
export const invoiceStatusLabel: Record<
  InvoiceStatus,
  { text: string; tone: 'neutral' | 'positive' | 'caution' | 'critical' | 'info' | 'unknown' }
> = {
  unpaid: { text: 'Unpaid', tone: 'caution' },
  partly_paid: { text: 'Partly paid', tone: 'info' },
  paid: { text: 'Paid', tone: 'positive' },
  credited: { text: 'Credited', tone: 'unknown' },
  settled: { text: 'Settled', tone: 'positive' },
};
export const methodText: Record<string, string> = {
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  other: 'Other',
};
export function validInvoicing(value: unknown): value is InvoicingOverview {
  const v = value as InvoicingOverview | null;
  return (
    !!v &&
    customerProvenanceAllowed(v.synthetic) &&
    typeof v.workspaceId === 'string' &&
    typeof v.canRead === 'boolean' &&
    typeof v.invoicesExist === 'boolean' &&
    v.paymentTaken === false &&
    Array.isArray(v.invoices) &&
    v.invoices.every(
      (i) =>
        typeof i.id === 'string' &&
        typeof i.number === 'string' &&
        typeof i.totalMinor === 'string' &&
        Array.isArray(i.payments) &&
        Array.isArray(i.credits),
    ) &&
    Array.isArray(v.balances) &&
    Number.isFinite(Date.parse(v.expiresAt))
  );
}

// Real invoices (ADR-064) come from the same endpoint and scope; a real deployment answers with the real shape.
export type { RealInvoice, RealInvoiceStatus, RealInvoicingOverview };
export function validRealInvoicing(value: unknown): value is RealInvoicingOverview {
  const v = value as RealInvoicingOverview | null;
  return (
    !!v &&
    v.synthetic === false &&
    customerProvenanceAllowed(v.synthetic) &&
    typeof v.workspaceId === 'string' &&
    typeof v.canRead === 'boolean' &&
    typeof v.invoicesExist === 'boolean' &&
    v.paymentTaken === false &&
    Array.isArray(v.invoices) &&
    v.invoices.every(
      (i) =>
        typeof i.id === 'string' &&
        typeof i.number === 'string' &&
        typeof i.totalMinor === 'string' &&
        typeof i.supplier?.legalName === 'string' &&
        typeof i.billTo?.name === 'string' &&
        Array.isArray(i.madeupFields) &&
        Array.isArray(i.payments) &&
        Array.isArray(i.credits),
    ) &&
    Array.isArray(v.balances) &&
    Number.isFinite(Date.parse(v.expiresAt))
  );
}
// Plain names for the supplier fields the owner has not supplied yet.
export const madeupFieldText: Record<string, string> = {
  legal_name: 'company name',
  address: 'address',
  country: 'country',
  uen: 'company registration number (UEN)',
  gst_registered: 'GST registration status',
  gst_registration_no: 'GST registration number',
  tax_label: 'tax name',
  gst_rate_bps: 'tax rate',
  payment_terms_days: 'payment terms',
  payment_instructions: 'payment instructions',
  finance_label: 'finance contact',
};
export const realInvoiceStatusLabel: Record<
  RealInvoiceStatus,
  { text: string; tone: 'neutral' | 'positive' | 'caution' | 'critical' | 'info' | 'unknown' }
> = invoiceStatusLabel;
export function ratePercent(bps: number | null) {
  return bps === null ? null : String(bps / 100) + '%';
}

// ADR-065: the simulated payment provider. Everything it shows says (madeup); an answer that does not is refused.
export type { SimulatedPayment, SimulatedPaymentsOverview };
export const simulatedPaymentsPath = '/api/customer-billing/simulated-payments';
const madeupText = (value: unknown) => typeof value === 'string' && value.endsWith('(madeup)');
export function validSimulatedPayments(value: unknown): value is SimulatedPaymentsOverview {
  const v = value as SimulatedPaymentsOverview | null;
  return (
    !!v &&
    v.synthetic === false &&
    customerProvenanceAllowed(v.synthetic) &&
    v.simulated === true &&
    v.moneyMoves === false &&
    v.paymentTaken === false &&
    typeof v.workspaceId === 'string' &&
    typeof v.canPay === 'boolean' &&
    madeupText(v.provider?.name) &&
    madeupText(v.provider?.refundPolicy) &&
    Array.isArray(v.payable) &&
    v.payable.every(
      (p) =>
        typeof p.invoiceId === 'string' &&
        typeof p.number === 'string' &&
        typeof p.outstandingMinor === 'string',
    ) &&
    Array.isArray(v.attempts) &&
    v.attempts.every(validSimulatedAttempt) &&
    Number.isFinite(Date.parse(v.expiresAt))
  );
}
export function validSimulatedAttempt(a: SimulatedPayment) {
  return (
    !!a &&
    typeof a.id === 'string' &&
    typeof a.amountMinor === 'string' &&
    a.simulated === true &&
    a.madeup === true &&
    a.moneyMoves === false &&
    madeupText(a.providerRef) &&
    madeupText(a.providerName) &&
    ['started', 'expired', 'succeeded', 'declined'].includes(a.state) &&
    Array.isArray(a.refunds)
  );
}
export function validSimulatedCommand(value: unknown): value is { attempt: SimulatedPayment } {
  const v = value as { attempt?: SimulatedPayment } | null;
  return !!v && !!v.attempt && validSimulatedAttempt(v.attempt);
}
export const simulatedStateLabel: Record<
  SimulatedPayment['state'],
  { text: string; tone: 'neutral' | 'positive' | 'caution' | 'critical' | 'info' | 'unknown' }
> = {
  started: { text: 'Waiting at checkout (madeup)', tone: 'info' },
  succeeded: { text: 'Approved (madeup)', tone: 'positive' },
  declined: { text: 'Declined (madeup)', tone: 'caution' },
  expired: { text: 'Expired (madeup)', tone: 'unknown' },
};
