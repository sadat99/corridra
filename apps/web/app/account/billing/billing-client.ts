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
): Promise<Outcome<T>> {
  try {
    const response = await fetch(
      endpoint + (query ? '?' + new URLSearchParams(query).toString() : ''),
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
