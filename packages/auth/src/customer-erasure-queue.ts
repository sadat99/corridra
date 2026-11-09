import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';
import { customerAccountLifecycleError } from './customer-account-lifecycle';
import type { CustomerAccountStatus, CustomerErasureStatus } from './customer-account-lifecycle';

// Staff side of the erasure requests. The staff session and tenant are the existing ones (members.manage: staff owner
// or admin with a fresh authenticator check), and the database repeats the check. Staff can read the queue and move a
// request along the allowed arrows; there is no function here that edits or deletes a person's request, invoice,
// signed decision or audit row. The route and the page are in apps/web.
const statuses = ['received', 'in_progress', 'completed', 'declined'] as const;

// The database refuses a note with any control character (a line break, a tab, an escape code) after it trims
// spaces. This says so in plain words before the call, and the page and the route use the same rule. U+2028 and
// U+2029 are line breaks the database also counts as control characters.
const controlCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
export const erasureNoteProblemText =
  'Notes must be on one line, with no line breaks, tabs or control characters';
export function erasureNoteProblem(note: unknown): string | null {
  return typeof note === 'string' && controlCharacters.test(note.trim())
    ? erasureNoteProblemText
    : null;
}
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
    note: z
      .string()
      .trim()
      .min(10)
      .max(1000)
      .refine((value) => !controlCharacters.test(value), erasureNoteProblemText)
      .optional(),
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

// The sample or real split of the queue lives in the scope function that account modules 0003 and 0004 add. Module 0001
// alone creates the queue and the move functions WITHOUT it, so with only 0001 installed they would show a staff
// workspace every customer, sample or real, and let it move any of them. So this service refuses, before it reads or
// changes anything, until that function exists. The check reads the catalogue, which the restricted runtime login may do
// (it cannot name the private schema). An installed module is remembered for the life of the process; a missing one is
// checked again after a minute, so the page works soon after the install without a redeploy.
const reprobeAfterMs = 60000;
let probe: { installed: boolean; at: number } | undefined;
export function resetErasureScopeProbe() {
  probe = undefined;
}
async function scopeInstalled(db: DatabaseClient) {
  const now = Date.now();
  if (probe && (probe.installed || now - probe.at < reprobeAfterMs)) return probe.installed;
  const row = (
    await db.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='customer_private' AND p.proname='erasure_in_scope' AND p.pronargs=1
          AND p.proargtypes[0]='uuid'::regtype) AS installed`,
    )
  ).rows[0];
  probe = { installed: row?.installed === true, at: now };
  return probe.installed;
}
async function requireScope(db: DatabaseClient) {
  if (!(await scopeInstalled(db)))
    throw new DomainError('The erasure queue is not available yet', 503, 'unavailable');
}

export class CustomerErasureQueue {
  constructor(private runtime: DatabasePool) {}

  async queue(ctx: RequestContext, input: unknown = {}): Promise<ErasureQueueRow[]> {
    const { afterNumber, pageSize, status } = erasureQueueQuery.parse(input);
    try {
      return await withTenant(this.runtime, ctx, 'members.manage', async (t) => {
        await requireScope(t.db);
        return (
          await t.db.query<{ rows: ErasureQueueRow[] }>(
            'SELECT customer.erasure_queue($1,$2,$3) AS rows',
            [afterNumber ?? null, pageSize, status ?? null],
          )
        ).rows[0]!.rows;
      });
    } catch (error) {
      throw customerAccountLifecycleError(error);
    }
  }

  async transition(ctx: RequestContext, input: unknown): Promise<ErasureTransitionDone> {
    const value = erasureTransitionInput.parse(input);
    try {
      return await withTenant(this.runtime, ctx, 'members.manage', async (t) => {
        await requireScope(t.db);
        return (
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
        ).rows[0]!.result;
      });
    } catch (error) {
      throw customerAccountLifecycleError(error);
    }
  }
}
