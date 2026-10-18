import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerRequestsEnabled } from './customer-requests';
import { customerSavedMissionsEnabled } from './customer-saved-missions';
export function customerDeliveryEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerSavedMissionsEnabled(env) &&
    customerRequestsEnabled(env) &&
    env.CORRIDRA_CUSTOMER_DELIVERY_ENABLED === 'true'
  );
}
const pageInput = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(25).default(10),
  })
  .strict();
export const acceptAssignedMissionInput = z
  .object({ commandId: z.uuid(), assignmentId: z.uuid(), acknowledged: z.literal(true) })
  .strict();
export class CustomerAssignedMissionService extends CustomerSessionBoundary {
  async list(input: unknown = {}, expectedSubject?: string, expectedIssuer?: string) {
    const p = pageInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.assigned_missions($1,$2) result', [
            p.after ?? null,
            p.pageSize,
          ])
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
  async accept(input: unknown, expectedSubject?: string, expectedIssuer?: string) {
    const v = acceptAssignedMissionInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.accept_assigned_mission($1,$2,$3) result', [
            v.commandId,
            v.assignmentId,
            v.acknowledged,
          ])
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
}
