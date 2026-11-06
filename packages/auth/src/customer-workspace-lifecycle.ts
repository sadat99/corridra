import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';

export function customerWorkspaceLifecycleEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerWorkspacesEnabled(env) && env.CORRIDRA_CUSTOMER_WORKSPACE_LIFECYCLE_ENABLED === 'true'
  );
}

const command = { commandId: z.uuid() };
const version = z.number().int().min(0).max(999999999);
// The typed workspace name is compared exactly by the database, so it is never trimmed or rewritten here.
const typedName = z.string().min(1).max(120);
export const customerWorkspaceLifecycleInput = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      action: z.literal('rename'),
      workspaceId: z.uuid(),
      name: z.string().trim().min(2).max(120),
      reason: z.string().trim().min(10).max(500),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('archive'),
      workspaceId: z.uuid(),
      expectedVersion: version,
      confirmName: typedName,
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('restore'),
      workspaceId: z.uuid(),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('offer_transfer'),
      workspaceId: z.uuid(),
      memberId: z.uuid(),
      confirmName: typedName,
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('cancel_transfer'),
      workspaceId: z.uuid(),
      offerId: z.uuid(),
    })
    .strict(),
  z.object({ ...command, action: z.literal('accept_transfer'), offerId: z.uuid() }).strict(),
  z.object({ ...command, action: z.literal('decline_transfer'), offerId: z.uuid() }).strict(),
]);
export const customerWorkspaceLifecycleQuery = z
  .object({ workspaceId: z.uuid().optional() })
  .strict();
export type CustomerWorkspaceLifecycleInput = z.infer<typeof customerWorkspaceLifecycleInput>;

// A stale expectedVersion writes nothing and answers with how the workspace stands, so the person can choose.
export type CustomerWorkspaceStale = {
  stale: true;
  workspaceId: string;
  currentVersion: number;
  currentName: string;
  archived: boolean;
};
export type CustomerWorkspaceLifecycleDone = {
  workspaceId: string;
  operation: 'rename' | 'archive' | 'restore' | 'offer' | 'cancel' | 'accept' | 'decline';
  // rename, archive and restore
  name?: string;
  archived?: boolean;
  version?: number;
  // offer, cancel, accept and decline
  offerId?: string;
  toMemberId?: string;
  expiresAt?: string;
  status?: 'cancelled' | 'accepted' | 'declined';
};
export type CustomerWorkspaceLifecycleOutcome =
  CustomerWorkspaceLifecycleDone | CustomerWorkspaceStale;
export function customerWorkspaceIsStale(
  outcome: CustomerWorkspaceLifecycleOutcome,
): outcome is CustomerWorkspaceStale {
  return 'stale' in outcome;
}
export type CustomerWorkspaceLifecycleSummary = {
  workspaceId: string;
  archived: boolean;
  version: number;
};
export type CustomerWorkspaceLifecycleState = {
  open: boolean;
  workspaceId: string;
  name: string;
  archived: boolean;
  version: number;
  role: 'owner' | 'admin' | 'member';
  history: {
    version: number;
    kind: 'rename' | 'archive' | 'restore';
    name: string;
    previousName: string;
    at: string;
    byYou: boolean;
    // Owners and admins only; null for a member.
    reason: string | null;
  }[];
  // The open ownership offer, shown to the owner who made it and to the member it names.
  offer: {
    offerId: string;
    toMemberId: string;
    expiresAt: string;
    toYou: boolean;
    byYou: boolean;
  } | null;
  // The workspace_member id of the person who became owner by a handover, so the team list can label them.
  ownerMemberId: string | null;
};

const unavailable = 'Workspace changes are unavailable';
// Turns what the database refused into what a person can act on. The database wording is plain and holds no internals.
export function customerWorkspaceLifecycleError(error: unknown): unknown {
  const { code, message } = error as { code?: string; message?: string };
  const text = typeof message === 'string' && message ? message : unavailable;
  switch (code) {
    case '42501':
      return new DomainError(text, 403);
    case '22023':
      return new DomainError(text, 400);
    case '23514':
      return new DomainError(text, 409);
    case '55000':
      return new DomainError(text, 409, 'archived');
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

// Server-only: the actual current provider session decides who is acting.
export class CustomerWorkspaceLifecycleService extends CustomerSessionBoundary {
  async state(
    input: { workspaceId?: string } = {},
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerWorkspaceLifecycleState | CustomerWorkspaceLifecycleSummary[]> {
    const { workspaceId } = customerWorkspaceLifecycleQuery.parse(input);
    try {
      return await this.transaction(
        async (db) =>
          (
            await db.query<{
              state: CustomerWorkspaceLifecycleState | CustomerWorkspaceLifecycleSummary[];
            }>('SELECT customer.workspace_lifecycle_state($1) AS state', [workspaceId ?? null])
          ).rows[0]!.state,
        expectedSubject,
        expectedIssuer,
      );
    } catch (error) {
      throw customerWorkspaceLifecycleError(error);
    }
  }

  async command(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerWorkspaceLifecycleOutcome> {
    const { action, commandId, ...payload } = customerWorkspaceLifecycleInput.parse(input);
    const lifecycle = 'SELECT customer.workspace_lifecycle_command($1,$2,$3) AS result';
    const ownership = 'SELECT customer.workspace_ownership_command($1,$2,$3) AS result';
    const [statement, operation] = {
      rename: [lifecycle, 'rename'],
      archive: [lifecycle, 'archive'],
      restore: [lifecycle, 'restore'],
      offer_transfer: [ownership, 'offer'],
      cancel_transfer: [ownership, 'cancel'],
      accept_transfer: [ownership, 'accept'],
      decline_transfer: [ownership, 'decline'],
    }[action];
    try {
      return await this.transaction(
        async (db) =>
          (
            await db.query<{ result: CustomerWorkspaceLifecycleOutcome }>(statement, [
              commandId,
              operation,
              JSON.stringify(payload),
            ])
          ).rows[0]!.result,
        expectedSubject,
        expectedIssuer,
      );
    } catch (error) {
      throw customerWorkspaceLifecycleError(error);
    }
  }
}
