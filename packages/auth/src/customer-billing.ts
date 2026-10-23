import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';

// ADR-060: synthetic plans, subscriptions and entitlements. Off unless the owner sets the switch, and then only for
// synthetic workspaces: the database refuses any other workspace. No payment, invoice or processor exists here.
export function customerBillingEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerWorkspacesEnabled(env) && env.CORRIDRA_CUSTOMER_BILLING_ENABLED === 'true';
}
const planKey = z.string().regex(/^[a-z][a-z0-9-]{2,59}$/);
export const customerBillingCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('request'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      planKey,
      planVersion: z.number().int().min(1).max(2147483646),
      planDigest: z.string().regex(/^[a-f0-9]{64}$/),
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.enum(['withdraw', 'cancel', 'keep']),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      subscriptionId: z.uuid(),
    })
    .strict(),
]);
export const customerBillingWorkspaceQuery = z.object({ workspaceId: z.uuid() }).strict();

export type BillingInterval = 'month' | 'year';
export type BillingTaxTreatment =
  'price_excludes_tax' | 'price_includes_tax' | 'tax_to_be_confirmed';
export type SubscriptionStatus =
  'requested' | 'active' | 'cancel_scheduled' | 'declined' | 'withdrawn' | 'ended';
export type BillingEntitlement = {
  key: string;
  label: string;
  description: string;
  unit: 'count' | 'flag';
  mode: 'limit' | 'unlimited' | 'included' | 'excluded';
  limit: number | null;
};
export type BillingPlan = {
  id: string;
  key: string;
  version: number;
  title: string;
  summary: string;
  interval: BillingInterval;
  // Exact whole minor units as digits, in `currency`. Never converted.
  priceMinor: string;
  currency: string;
  taxTreatment: BillingTaxTreatment;
  included: string[];
  excluded: string[];
  entitlements: BillingEntitlement[];
  digest: string;
  active: boolean;
  synthetic: true;
  invoicing: 'not_enabled';
  paymentTaken: false;
};
export type BillingPlans = {
  workspaceId: string;
  canRequest: boolean;
  plans: BillingPlan[];
  entitlementsEnforced: false;
  invoicing: 'not_enabled';
  paymentTaken: false;
  synthetic: true;
  expiresAt: string;
};
export type SubscriptionSummary = {
  id: string;
  workspaceId: string;
  planKey: string;
  planVersion: number;
  planTitle: string;
  interval: BillingInterval;
  priceMinor: string;
  currency: string;
  taxTreatment: BillingTaxTreatment;
  status: SubscriptionStatus;
  periodStart: string | null;
  periodEnd: string | null;
  periodElapsed: boolean;
  createdAt: string;
  updatedAt: string;
};
export type SubscriptionTimelineEntry = {
  seq: number;
  at: string;
  kind: string;
  status: SubscriptionStatus;
  by: string;
  note: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  endReason: 'ended_by_team' | 'replaced' | 'period_elapsed' | null;
};
export type BillingOverview = {
  workspaceId: string;
  canAct: boolean;
  current: SubscriptionSummary | null;
  pending: SubscriptionSummary | null;
  entitlements: BillingEntitlement[];
  entitlementsEnforced: false;
  subscriptions: (SubscriptionSummary & { timeline: SubscriptionTimelineEntry[] })[];
  actions: ('request' | 'withdraw' | 'cancel' | 'keep')[];
  invoicing: 'not_enabled';
  paymentTaken: false;
  synthetic: true;
  expiresAt: string;
};
export type BillingCommandResult = SubscriptionSummary & {
  commandId: string;
  operation: 'request' | 'withdraw' | 'cancel' | 'keep';
  synthetic: true;
};

// Server-only: the current provider session decides who is acting; the workspace role comes from the database.
export class CustomerBillingService extends CustomerSessionBoundary {
  async plans(input: unknown, subject?: string, issuer?: string) {
    const q = customerBillingWorkspaceQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: BillingPlans }>('SELECT customer.billing_plans($1) AS result', [
            q.workspaceId,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async overview(input: unknown, subject?: string, issuer?: string) {
    const q = customerBillingWorkspaceQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: BillingOverview }>(
            'SELECT customer.billing_overview($1) AS result',
            [q.workspaceId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async command(input: unknown, subject?: string, issuer?: string) {
    const { action, commandId, ...payload } = customerBillingCommandInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: BillingCommandResult }>(
            'SELECT customer.billing_command($1,$2,$3) AS result',
            [commandId, action, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
