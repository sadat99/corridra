import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { CustomerSessionBoundary } from './customer-session';
import { customerAccountGateEnabled } from './customer-account-gate';

export {
  closedAccountGate,
  accountClosedCode,
  resetClosedAccountGateCache,
} from './customer-account-gate';

export function customerAccountLifecycleEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerAccountGateEnabled(env);
}

// Words a person is asked to type or read. The privacy wording is pending the owner's named review: nothing here is
// the reviewed privacy notice, and a changed word is a change to this constant only.
export const accountLifecycleWords = {
  // pending the owner's named review
  closePhrase: 'Close my account',
  // pending the owner's named review
  privacyContact: 'Write to the privacy contact on the privacy page.',
} as const;

const command = { commandId: z.uuid() };
// Self only: no person id, subject or issuer is accepted anywhere, and any extra key is refused.
export const customerAccountLifecycleInput = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      action: z.literal('close'),
      confirmation: z.literal(accountLifecycleWords.closePhrase),
    })
    .strict(),
  z.object({ ...command, action: z.literal('undo') }).strict(),
  z.object({ ...command, action: z.literal('file_erasure') }).strict(),
]);
export type CustomerAccountLifecycleInput = z.infer<typeof customerAccountLifecycleInput>;

export type CustomerAccountStatus = 'active' | 'closed' | 'final';
export type CustomerErasureStatus = 'received' | 'in_progress' | 'completed' | 'declined';
export type CustomerAccountLifecycleState = {
  open: boolean;
  status: CustomerAccountStatus;
  // null while the account is active
  closedAt: string | null;
  undoUntil: string | null;
  canUndo: boolean;
  erasure: {
    reference: string;
    filedAt: string;
    dueAt: string;
    status: CustomerErasureStatus;
    note: string | null;
  } | null;
  // The workspaces to hand over or archive before the account can close.
  blockers: { workspaceId: string; name: string }[];
};
export type CustomerAccountLifecycleDone =
  | {
      operation: 'close';
      changed: boolean;
      status: 'closed' | 'final';
      closedAt: string;
      undoUntil: string;
    }
  | { operation: 'undo'; changed: true; status: 'active'; closedAt: null; undoUntil: null }
  | {
      operation: 'file_erasure';
      changed: boolean;
      reference: string;
      filedAt: string;
      dueAt: string;
    };

const unavailable = 'Account changes are unavailable';
// Turns what the database refused into what a person can act on. The database wording is plain and holds no internals.
export function customerAccountLifecycleError(error: unknown): unknown {
  const { code, message } = error as { code?: string; message?: string };
  const text = typeof message === 'string' && message ? message : unavailable;
  switch (code) {
    case '42501':
      return new DomainError(text, 403);
    case '22023':
      return new DomainError(text, 400);
    case '23514':
      return new DomainError(text, 409);
    case '0A000':
      return new DomainError(text, 503, 'unavailable');
    case '42P01':
    case '3F000':
    case '42883':
      return new DomainError(unavailable, 503, 'unavailable');
    default:
      return error;
  }
}

// Server-only: the actual current provider session decides who is acting. A closed person can read the state and undo,
// and nothing else: closing again or filing an erasure request goes through the closed-account check like any call.
export class CustomerAccountLifecycleService extends CustomerSessionBoundary {
  async state(
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerAccountLifecycleState> {
    try {
      return await this.transaction(
        async (db) =>
          (
            await db.query<{ state: CustomerAccountLifecycleState }>(
              'SELECT customer.account_lifecycle_state() AS state',
            )
          ).rows[0]!.state,
        expectedSubject,
        expectedIssuer,
        undefined,
        { allowClosedAccount: true },
      );
    } catch (error) {
      throw customerAccountLifecycleError(error);
    }
  }

  async command(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerAccountLifecycleDone> {
    const { action, commandId, ...payload } = customerAccountLifecycleInput.parse(input);
    try {
      return await this.transaction(
        async (db) =>
          (
            await db.query<{ result: CustomerAccountLifecycleDone }>(
              'SELECT customer.account_lifecycle_command($1,$2,$3) AS result',
              [commandId, action, JSON.stringify(payload)],
            )
          ).rows[0]!.result,
        expectedSubject,
        expectedIssuer,
        undefined,
        { allowClosedAccount: action === 'undo' },
      );
    } catch (error) {
      throw customerAccountLifecycleError(error);
    }
  }
}
