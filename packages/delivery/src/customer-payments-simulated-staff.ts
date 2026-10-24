import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';

const control = /[\u0000-\u001f\u007f]/u;
// Text that staff write is plain: no links, addresses or control characters. The database repeats this.
const plain = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) => !control.test(v) && !/(:\/\/|@|www\.)/.test(v),
      'Plain text only, no links or addresses',
    );
export const simulatedPaymentsStaffCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('refund'),
      commandId: z.uuid(),
      attemptId: z.uuid(),
      amountMinor: z.string().regex(/^[1-9][0-9]{0,11}$/),
      reason: plain(10, 500),
    })
    .strict(),
]);
export const simulatedPaymentsStaffListQuery = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
export const simulatedPaymentsStaffOffMessage = 'The simulated payment flow is not switched on yet';

// Staff side of the simulated provider (ADR-065). Authority is the existing protected staff authority (owner or admin with
// a fresh authenticator check in a real operator workspace); the database repeats the check on the live session. A closed
// control answers 503. Nothing here is real money.
export class CustomerSimulatedPaymentsStaffService {
  constructor(private pool: DatabasePool) {}
  private async read<T>(ctx: RequestContext, work: (db: DatabaseClient) => Promise<T>) {
    try {
      return await withTenant(this.pool, ctx, 'delivery.share', async ({ db }) => work(db));
    } catch (error) {
      if ((error as { code?: string }).code === '55000')
        throw new DomainError(simulatedPaymentsStaffOffMessage, 503);
      throw error;
    }
  }
  async list(ctx: RequestContext, input: unknown = {}) {
    const q = simulatedPaymentsStaffListQuery.parse(input);
    return this.read(
      ctx,
      async (db) =>
        (
          await db.query('SELECT app.simulated_payments_staff_list($1,$2) result', [
            q.after ?? null,
            q.pageSize,
          ])
        ).rows[0].result,
    );
  }
  async command(ctx: RequestContext, input: unknown) {
    const { action, commandId, ...payload } = simulatedPaymentsStaffCommandInput.parse(input);
    return this.read(
      ctx,
      async (db) =>
        (
          await db.query('SELECT app.simulated_payments_staff_command($1,$2,$3) result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
    );
  }
}
