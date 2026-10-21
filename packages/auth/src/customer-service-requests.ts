import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';

export function customerServiceRequestsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerWorkspacesEnabled(env) && env.CORRIDRA_CUSTOMER_SERVICE_REQUESTS_ENABLED === 'true'
  );
}
export const serviceContextKinds = ['request', 'programme', 'company'] as const;
const control = /[\u0000-\u001f\u007f]/u;
// Every free-text field is invented text. The database repeats this rule.
const syntheticText = (max: number) =>
  z
    .string()
    .trim()
    .min(11)
    .max(max)
    .regex(/^Synthetic /)
    .refine((v) => !control.test(v), 'Control characters are not allowed');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const contextRef = z
  .string()
  .regex(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{64})$/);
const needFields = {
  need: syntheticText(1000),
  preferredFrom: day.nullable(),
  preferredTo: day.nullable(),
  region: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine((v) => !control.test(v)),
};
export const customerServiceCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      contextKind: z.enum(serviceContextKinds),
      contextRef,
      serviceKey: z.string().regex(/^[a-z][a-z0-9-]{2,59}$/),
      ...needFields,
    })
    .strict(),
  z
    .object({
      action: z.literal('revise'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      requestId: z.uuid(),
      expectedNeedVersion: z.number().int().min(1).max(1000),
      ...needFields,
    })
    .strict(),
  z
    .object({
      action: z.literal('question'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      requestId: z.uuid(),
      note: syntheticText(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('accept'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      requestId: z.uuid(),
      quoteVersion: z.number().int().min(1).max(100),
      quoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.enum(['decline', 'withdraw']),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      requestId: z.uuid(),
      note: syntheticText(1000).nullable(),
    })
    .strict(),
]);
export const customerServiceListQuery = z
  .object({
    workspaceId: z.uuid(),
    contextKind: z.enum(serviceContextKinds).optional(),
    contextRef: contextRef.optional(),
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict()
  .refine((v) => (v.contextKind === undefined) === (v.contextRef === undefined), 'Both or neither');
export const customerServiceViewQuery = z
  .object({ workspaceId: z.uuid(), requestId: z.uuid() })
  .strict();

export type ServiceStatus =
  | 'requested'
  | 'quoted'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'in_progress'
  | 'delivered'
  | 'closed';
export type ServiceRequestSummary = {
  id: string;
  workspaceId: string;
  contextKind: (typeof serviceContextKinds)[number];
  contextRef: string;
  contextLabel: string;
  serviceKey: string;
  serviceTitle: string;
  status: ServiceStatus;
  needVersion: number;
  region: string;
  createdAt: string;
  updatedAt: string;
};
export type ServiceQuoteComponent = {
  position: number;
  kind: 'service_fee' | 'local_cost' | 'pass_through' | 'tax';
  label: string;
  treatment: 'included' | 'estimate' | 'not_included';
  amountMinor: string | null;
};
export type ServiceQuote = {
  id: string;
  version: number;
  currency: string;
  scope: string;
  components: ServiceQuoteComponent[];
  fixedTotalMinor: string;
  estimatedTotalMinor: string;
  exclusions: string[];
  assumptions: string[];
  deliveryTerms: string;
  paymentTerms: string;
  validUntil: string;
  preparedAt: string;
  expired: boolean;
  digest: string;
  synthetic: true;
  billing: 'billing_not_enabled';
  paymentTaken: false;
};
export type ServiceCatalogueEntry = {
  key: string;
  version: number;
  title: string;
  summary: string;
  included: string[];
  excluded: string[];
  regions: string[];
  quoteBasis: 'per_day' | 'per_visit' | 'per_item' | 'fixed_scope';
  synthetic: true;
};
export type ServiceRequestDetail = {
  workspaceId: string;
  canAct: boolean;
  request: ServiceRequestSummary & { serviceVersion: number };
  service: Omit<ServiceCatalogueEntry, 'key' | 'version' | 'synthetic'>;
  need: {
    version: number;
    text: string;
    preferredFrom: string | null;
    preferredTo: string | null;
    region: string;
    updatedAt: string;
  };
  quote: ServiceQuote | null;
  orderIntent: {
    id: string;
    quoteVersion: number;
    currency: string;
    fixedTotalMinor: string;
    estimatedTotalMinor: string;
    acceptedAt: string;
    orderStatus: 'accepted_by_customer';
    paymentTaken: false;
    billing: 'billing_not_enabled';
    statement: string;
  } | null;
  timeline: {
    seq: number;
    at: string;
    kind: string;
    status: ServiceStatus;
    by: string;
    note: string | null;
    quoteVersion: number | null;
  }[];
  actions: ('revise' | 'question' | 'withdraw' | 'accept' | 'decline')[];
  synthetic: true;
  expiresAt: string;
};

// Server-only: the current provider session decides who is acting; the workspace role comes from the database.
export class CustomerServiceRequestService extends CustomerSessionBoundary {
  async catalogue(subject?: string, issuer?: string) {
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: { services: ServiceCatalogueEntry[]; expiresAt: string } }>(
            'SELECT customer.service_catalogue() AS result',
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async list(input: unknown, subject?: string, issuer?: string) {
    const q = customerServiceListQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{
            result: {
              workspaceId: string;
              canRequest: boolean;
              requests: ServiceRequestSummary[];
              nextAfter: string | null;
              expiresAt: string;
            };
          }>('SELECT customer.service_request_list($1,$2,$3,$4,$5) AS result', [
            q.workspaceId,
            q.contextKind ?? null,
            q.contextRef ?? null,
            q.after ?? null,
            q.pageSize,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async view(input: unknown, subject?: string, issuer?: string) {
    const q = customerServiceViewQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: ServiceRequestDetail }>(
            'SELECT customer.service_request_view($1,$2) AS result',
            [q.workspaceId, q.requestId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async command(input: unknown, subject?: string, issuer?: string) {
    const { action, commandId, ...payload } = customerServiceCommandInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: ServiceRequestSummary & { commandId: string } }>(
            'SELECT customer.service_request_command($1,$2,$3) AS result',
            [commandId, action, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
