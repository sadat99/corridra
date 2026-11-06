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
const lifecycleBase = {
  commandId: z.uuid(),
  workspaceId: z.uuid(),
  programmeId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(100000),
};
// Rename, archive and restore (CRUD gap G7). Rename sends the new name and reporting purpose exactly as create does;
// archive and restore carry nothing else. The database refuses a stale expectedVersion with a plain message.
export const customerProgrammeLifecycleInput = z.discriminatedUnion('operation', [
  z
    .object({
      ...lifecycleBase,
      operation: z.literal('rename'),
      name: programmeInput.shape.name,
      reportingPurpose: programmeInput.shape.reportingPurpose,
    })
    .strict(),
  z.object({ ...lifecycleBase, operation: z.enum(['archive', 'restore']) }).strict(),
]);
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
  async change(input: unknown, expectedSubject?: string, expectedIssuer?: string) {
    const value = customerProgrammeLifecycleInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_lifecycle($1,$2,$3,$4,$5,$6) AS result', [
            value.commandId,
            value.workspaceId,
            value.programmeId,
            value.operation,
            value.expectedVersion,
            JSON.stringify(
              value.operation === 'rename'
                ? { name: value.name, reportingPurpose: value.reportingPurpose }
                : {},
            ),
          ])
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
}
