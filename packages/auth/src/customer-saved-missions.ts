import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';
export function customerSavedMissionsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerWorkspacesEnabled(env) &&
    env.CORRIDRA_CUSTOMER_SAVED_MISSIONS_ENABLED === 'true' &&
    env.CORRIDRA_DELIVERY_ENABLED === 'true'
  );
}
export const savedMissionInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      commandId: z.uuid(),
      token: z.string().regex(/^[a-f0-9]{64}$/),
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('view'),
      resourceId: z.uuid(),
      audience: z.literal('CLIENT_PROGRESS'),
    })
    .strict(),
  z
    .object({
      action: z.literal('respond'),
      resourceId: z.uuid(),
      audience: z.literal('CLIENT_PROGRESS'),
      commandId: z.uuid(),
      requestId: z.uuid(),
      body: z.string().trim().min(3).max(2000),
      acknowledged: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('remove'), resourceId: z.uuid(), commandId: z.uuid() }).strict(),
]);
const pageInput = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(25).default(25),
  })
  .strict();
export class CustomerSavedMissionService extends CustomerSessionBoundary {
  async list(input: unknown = {}, expectedSubject?: string, expectedIssuer?: string) {
    this.requireRealReports();
    const page = pageInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.saved_missions($1,$2) AS result', [
            page.after ?? null,
            page.pageSize,
          ])
        ).rows[0].result,
      expectedSubject,
      expectedIssuer,
    );
  }
  async command(input: unknown, expectedSubject?: string, expectedIssuer?: string) {
    this.requireRealReports();
    const value = savedMissionInput.parse(input);
    return this.transaction(
      async (db) => {
        if (value.action === 'save')
          return (
            await db.query('SELECT customer.save_mission_invitation($1,$2) AS result', [
              value.commandId,
              createHash('sha256').update(value.token).digest('hex'),
            ])
          ).rows[0].result;
        if (value.action === 'remove')
          return (
            await db.query('SELECT customer.remove_saved_mission($1,$2) AS result', [
              value.commandId,
              value.resourceId,
            ])
          ).rows[0].result;
        return (
          await db.query('SELECT customer.saved_mission_action($1,$2,$3,$4) AS result', [
            value.resourceId,
            value.action === 'respond' ? value.commandId : null,
            value.action === 'respond' ? value.requestId : null,
            value.action === 'respond' ? value.body : null,
          ])
        ).rows[0].result;
      },
      expectedSubject,
      expectedIssuer,
    );
  }
}
