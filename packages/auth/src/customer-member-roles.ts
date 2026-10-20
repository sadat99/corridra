import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';

export function customerMemberRolesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerWorkspacesEnabled(env) && env.CORRIDRA_CUSTOMER_MEMBER_ROLES_ENABLED === 'true';
}
// Invited members are either admin or member. The original owner is never changed or removed here.
export const customerMemberRoles = ['admin', 'member'] as const;
export const customerMemberCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set_role'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      memberId: z.uuid(),
      role: z.enum(customerMemberRoles),
      expectedRole: z.enum(customerMemberRoles),
    })
    .strict(),
  z
    .object({
      action: z.literal('leave'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
    })
    .strict(),
]);
export type CustomerMemberCommandOutcome = {
  workspaceId: string;
  memberId: string;
  role?: 'admin' | 'member';
  roleVersion?: number;
  status?: 'left';
};
// Server-only: the actual current provider session decides who is acting.
export class CustomerMemberRoleService extends CustomerSessionBoundary {
  async command(
    input: unknown,
    expectedSubject?: string,
    expectedIssuer?: string,
  ): Promise<CustomerMemberCommandOutcome> {
    const { action, commandId, ...payload } = customerMemberCommandInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerMemberCommandOutcome }>(
            'SELECT customer.workspace_member_command($1,$2,$3) AS result',
            [commandId, action, JSON.stringify(payload)],
          )
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
}
