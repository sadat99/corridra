import { randomBytes } from 'node:crypto';
import { customerProductionLocked } from './customer-production';
import { z } from 'zod';
import { DomainError } from '@corridra/domain';
import { sessionHash } from '@corridra/db';
import { CustomerSessionBoundary } from './customer-session';
export {
  customerIssuer,
  type CustomerSession,
  type CustomerWorkspaceOptions,
} from './customer-session';

export const customerWorkspaceInput = z
  .object({
    commandId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(11)
      .max(120)
      .startsWith('Synthetic ')
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  })
  .strict();
export type CustomerWorkspace = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  synthetic: true;
  organisationId: null;
};

export const customerAccessInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('invite'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      label: customerWorkspaceInput.shape.name,
    })
    .strict(),
  z
    .object({
      action: z.literal('accept'),
      commandId: z.uuid(),
      token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal('revoke'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      kind: z.enum(['invitation', 'membership']),
      targetId: z.uuid(),
    })
    .strict(),
]);
const accessPageInput = z
  .object({
    workspaceId: z.uuid(),
    invitationAfter: z.uuid().optional(),
    memberAfter: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CustomerAccessOutcome = {
  workspaceId: string;
  invitationId?: string;
  memberId?: string;
  expiresAt?: string;
  status?: 'cancelled' | 'revoked';
  issued?: boolean;
  token?: string | null;
  workspace?: CustomerWorkspace;
};
export type CustomerAccessPage = {
  workspaceId: string;
  ownerProtected: true;
  invitations: {
    id: string;
    label: string;
    expiresAt: string;
    memberId: string | null;
    status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  }[];
  memberships: {
    id: string;
    label: string;
    role: 'member';
    createdAt: string;
    status: 'active' | 'revoked' | 'account-disabled';
  }[];
  nextInvitationAfter: string | null;
  nextMemberAfter: string | null;
};

export function customerWorkspacesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.CORRIDRA_CUSTOMER_WORKSPACES_ENABLED === 'true' &&
    env.DATA_ENVIRONMENT === 'synthetic' &&
    !customerProductionLocked(env)
  );
}

// This service is server-only: readSession must fetch the actual current provider
// session. No handler may deserialize CustomerSession from a request body/header.
export class CustomerWorkspaceService extends CustomerSessionBoundary {
  async list(expectedSubject?: string, expectedIssuer?: string): Promise<CustomerWorkspace[]> {
    return this.transaction(
      async (db) => {
        const result = await db.query('SELECT * FROM customer.collaborative_workspaces()');
        return result.rows.map((row) => ({
          id: row.id,
          name: row.name,
          role: row.role,
          synthetic: row.synthetic,
          organisationId: row.organisation_id,
        }));
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async provision(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerWorkspace> {
    const value = customerWorkspaceInput.parse(input);
    return this.transaction(
      async (db) => {
        const {
          rows: [row],
        } = await db.query('SELECT customer.provision_workspace($1,$2) AS id', [
          value.commandId,
          value.name,
        ]);
        const result = await db.query('SELECT * FROM customer.workspaces() WHERE id=$1', [row.id]);
        if (!result.rows[0]) throw new DomainError('Customer workspace is unavailable', 403);
        const workspace = result.rows[0];
        return {
          id: workspace.id,
          name: workspace.name,
          role: workspace.role,
          synthetic: workspace.synthetic,
          organisationId: workspace.organisation_id,
        };
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async listAccess(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerAccessPage> {
    const value = accessPageInput.parse(input);
    return this.transaction(
      async (db) => {
        const {
          rows: [row],
        } = await db.query<{ result: CustomerAccessPage }>(
          'SELECT customer.workspace_access_list($1,$2,$3,$4) AS result',
          [
            value.workspaceId,
            value.invitationAfter ?? null,
            value.memberAfter ?? null,
            value.pageSize,
          ],
        );
        return row.result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }

  async access(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerAccessOutcome> {
    const value = customerAccessInput.parse(input);
    return this.transaction(
      async (db) => {
        // Only a hash reaches PostgreSQL. A lost first response cannot recover the secret.
        const token = value.action === 'invite' ? randomBytes(32).toString('base64url') : null;
        const payload =
          value.action === 'invite'
            ? { workspaceId: value.workspaceId, label: value.label, tokenHash: sessionHash(token!) }
            : value.action === 'accept'
              ? { tokenHash: sessionHash(value.token) }
              : { workspaceId: value.workspaceId, kind: value.kind, targetId: value.targetId };
        const {
          rows: [row],
        } = await db.query<{ result: CustomerAccessOutcome }>(
          'SELECT customer.workspace_access_command($1,$2,$3) AS result',
          [value.commandId, value.action, JSON.stringify(payload)],
        );
        const result = row.result;
        if (value.action === 'invite')
          return { ...result, token: result.issued === true ? token : null };
        if (value.action === 'accept') {
          const {
            rows: [workspace],
          } = await db.query('SELECT * FROM customer.collaborative_workspaces() WHERE id=$1', [
            result.workspaceId,
          ]);
          if (!workspace) throw new DomainError('Customer workspace is unavailable', 403);
          return {
            ...result,
            workspace: {
              id: workspace.id,
              name: workspace.name,
              role: workspace.role,
              synthetic: workspace.synthetic,
              organisationId: workspace.organisation_id,
            },
          };
        }
        return result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }
}
