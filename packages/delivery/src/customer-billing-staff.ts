import { z } from 'zod';
import { customerLabelAllowed, realCustomerInput } from '@corridra/domain/customer-input-mode';
import { DomainError } from '@corridra/domain';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';

const control = /[\u0000-\u001f\u007f]/u;
// Notes that staff write about a subscription: invented text for a sample workspace, plain text for a real one. The
// database applies the rule that fits the workspace.
const synthetic = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
    .refine((v) => !control.test(v), 'Control characters are not allowed');
const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((v) => !control.test(v) && !/(:\/\/|@|www\.)/.test(v), 'Plain text only');
const subscriptionRef = { subscriptionId: z.uuid(), expectedSeq: z.number().int().min(1).max(500) };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const staffBillingCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('activate'),
      commandId: z.uuid(),
      ...subscriptionRef,
      periodStart: day,
      customerNote: synthetic(1000).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('renew'),
      commandId: z.uuid(),
      ...subscriptionRef,
      customerNote: synthetic(1000).nullable(),
    })
    .strict(),
  z
    .object({
      action: z.enum(['decline', 'end']),
      commandId: z.uuid(),
      ...subscriptionRef,
      customerNote: synthetic(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal('note'),
      commandId: z.uuid(),
      ...subscriptionRef,
      internalNote: synthetic(1000),
    })
    .strict(),
]);
export const staffPlanEntitlementInput = z
  .object({
    key: z.string().regex(/^[a-z][a-z_]{2,39}$/),
    mode: z.enum(['limit', 'unlimited', 'included', 'excluded']),
    limit: z.number().int().min(0).max(100000).nullable(),
  })
  .strict()
  .refine(
    (e) => (e.mode === 'limit') === (e.limit !== null),
    'A limit is given only in limit mode',
  );
export const staffPlanInput = z
  .object({
    commandId: z.uuid(),
    planKey: z.string().regex(/^[a-z][a-z0-9-]{2,59}$/),
    expectedVersion: z.number().int().min(0).max(2147483646),
    // A sample plan must say it is a sample and a real plan must not. The database holds both rules; here real
    // wording is accepted only where real input is, as for every other customer form.
    title: plain(3, 120).refine(
      (v) => realCustomerInput() || /(sample|synthetic)/i.test(v),
      'The title must say the plan is a sample',
    ),
    summary: plain(10, 400),
    interval: z.enum(['month', 'year']),
    // Whole minor units as digits, in the plan currency.
    priceMinor: z.string().regex(/^(0|[1-9][0-9]{0,10})$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    taxTreatment: z.enum(['price_excludes_tax', 'price_includes_tax', 'tax_to_be_confirmed']),
    included: z.array(plain(3, 200)).min(1).max(12),
    excluded: z.array(plain(3, 200)).min(1).max(12),
    active: z.boolean(),
    entitlements: z.array(staffPlanEntitlementInput).min(1).max(20),
  })
  .strict();
export const staffBillingListQuery = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

// Staff side of billing. Authority is the existing protected staff authority (owner or admin with a fresh
// authenticator check in an operator workspace); the database repeats the check on the live session. A real operator
// workspace reaches real subscriptions only while `allowReal` says the application switch is on (ADR-062); the answer
// is checked inside the transaction so a refusal rolls back.
export class CustomerBillingStaffService {
  constructor(
    private pool: DatabasePool,
    private allowReal: () => boolean = () => false,
  ) {}
  private checked<T extends { synthetic?: boolean }>(result: T) {
    if (result.synthetic === false && !this.allowReal())
      throw new DomainError('Plans are not switched on for real workspaces yet', 503);
    return result;
  }
  async list(ctx: RequestContext, input: unknown = {}) {
    const q = staffBillingListQuery.parse(input);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db }) =>
      this.checked(
        (
          await db.query('SELECT app.billing_staff_list($1,$2) result', [
            q.after ?? null,
            q.pageSize,
          ])
        ).rows[0].result,
      ),
    );
  }
  async view(ctx: RequestContext, subscriptionId: string) {
    const id = z.uuid().parse(subscriptionId);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db }) =>
      this.checked(
        (await db.query('SELECT app.billing_staff_view($1) result', [id])).rows[0].result,
      ),
    );
  }
  async command(ctx: RequestContext, input: unknown) {
    const { action, commandId, ...payload } = staffBillingCommandInput.parse(input);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db }) =>
      this.checked(
        (
          await db.query('SELECT app.billing_staff_command($1,$2,$3) result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
      ),
    );
  }
  async plans(ctx: RequestContext) {
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db }) =>
      this.checked((await db.query('SELECT app.billing_plan_staff_list() result')).rows[0].result),
    );
  }
  async revisePlan(ctx: RequestContext, input: unknown) {
    const { commandId, ...payload } = staffPlanInput.parse(input);
    return withTenant(this.pool, ctx, 'delivery.share', async ({ db }) =>
      this.checked(
        (
          await db.query('SELECT app.billing_plan_staff_command($1,$2) result', [
            commandId,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
      ),
    );
  }
}
