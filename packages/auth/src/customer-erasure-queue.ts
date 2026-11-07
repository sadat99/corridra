import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { customerAccountLifecycleError } from './customer-account-lifecycle';
import type { CustomerAccountStatus, CustomerErasureStatus } from './customer-account-lifecycle';

// Staff side of the erasure requests. The staff session and tenant are the existing ones (members.manage: staff owner
// or admin with a fresh authenticator check), and the database repeats the check. Staff can read the queue and move a
// request along the allowed arrows; there is no function here that edits or deletes a person's request, invoice,
// signed decision or audit row. The route and the page are separate work.
const statuses = ['received', 'in_progress', 'completed', 'declined'] as const;
export const erasureQueueQuery = z
  .object({
    afterNumber: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    pageSize: z.number().int().min(1).max(100).default(25),
    status: z.enum(statuses).optional(),
  })
  .strict();
export const erasureTransitionInput = z
  .object({
    commandId: z.uuid(),
    requestId: z.uuid(),
    expectedState: z.enum(['received', 'in_progress']),
    toState: z.enum(['in_progress', 'completed', 'declined']),
    // What was kept and why. Required to complete or decline; the person can read it.
    note: z.string().trim().min(10).max(1000).optional(),
  })
  .strict()
  .refine((value) => value.toState === 'in_progress' || value.note !== undefined, {
    message: 'A note is required to complete or decline a request',
    path: ['note'],
  });

export type ErasureQueueRow = {
  id: string;
  number: number;
  reference: string;
  filedAt: string;
  dueAt: string;
  daysLeft: number;
  status: CustomerErasureStatus;
  note: string | null;
  principalId: string;
  // active, closed or final. Staff say "closed, can be undone until <undoUntil>" when it is closed.
  accountStatus: CustomerAccountStatus;
  closedAt: string | null;
  undoUntil: string | null;
};
export type ErasureTransitionDone = {
  id: string;
  reference: string;
  status: CustomerErasureStatus;
  note: string | null;
  changed: boolean;
};

export class CustomerErasureQueue {
  constructor(private runtime: DatabasePool) {}

  async queue(ctx: RequestContext, input: unknown = {}): Promise<ErasureQueueRow[]> {
    const { afterNumber, pageSize, status } = erasureQueueQuery.parse(input);
    try {
      return await withTenant(
        this.runtime,
        ctx,
        'members.manage',
        async (t) =>
          (
            await t.db.query<{ rows: ErasureQueueRow[] }>(
              'SELECT customer.erasure_queue($1,$2,$3) AS rows',
              [afterNumber ?? null, pageSize, status ?? null],
            )
          ).rows[0]!.rows,
      );
    } catch (error) {
      throw customerAccountLifecycleError(error);
    }
  }

  async transition(ctx: RequestContext, input: unknown): Promise<ErasureTransitionDone> {
    const value = erasureTransitionInput.parse(input);
    try {
      return await withTenant(
        this.runtime,
        ctx,
        'members.manage',
        async (t) =>
          (
            await t.db.query<{ result: ErasureTransitionDone }>(
              'SELECT customer.erasure_transition($1,$2,$3,$4,$5) AS result',
              [
                value.commandId,
                value.requestId,
                value.expectedState,
                value.toState,
                value.note ?? null,
              ],
            )
          ).rows[0]!.result,
      );
    } catch (error) {
      throw customerAccountLifecycleError(error);
    }
  }
}
