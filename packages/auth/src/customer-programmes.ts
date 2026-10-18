import { z } from 'zod';
import { programmeInput } from '@corridra/domain/delivery';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';
export function customerProgrammesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerWorkspacesEnabled(env) && env.CORRIDRA_CUSTOMER_PROGRAMMES_ENABLED === 'true';
}
export const customerProgrammeInput = programmeInput
  .extend({ workspaceId: z.uuid(), acknowledged: z.literal(true) })
  .strict();
const pageInput = z
  .object({
    workspaceId: z.uuid(),
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(25).default(25),
  })
  .strict();
export class CustomerProgrammeService extends CustomerSessionBoundary {
  async create(input: unknown, expectedSubject?: string, expectedIssuer?: string) {
    const value = customerProgrammeInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.create_programme($1,$2,$3,$4) AS result', [
            value.commandId,
            value.workspaceId,
            value.name,
            value.reportingPurpose,
          ])
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
  async list(input: unknown, expectedSubject?: string, expectedIssuer?: string) {
    const value = pageInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programmes($1,$2,$3) AS result', [
            value.workspaceId,
            value.after ?? null,
            value.pageSize,
          ])
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
}
