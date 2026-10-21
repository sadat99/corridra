import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerParticipantsEnabled } from './customer-participants';
import { customerRequestDetailsEnabled } from './customer-request-details';
export function customerMissionSharesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerParticipantsEnabled(env) &&
    customerRequestDetailsEnabled(env) &&
    env.CORRIDRA_CUSTOMER_MISSION_SHARES_ENABLED === 'true'
  );
}
const version = z.number().int().min(0).max(2147483646);
export const customerMissionShareInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('share'),
      commandId: z.uuid(),
      registrationId: z.uuid(),
      requestId: z.uuid(),
      expectedVersion: version,
      summary: z
        .string()
        .trim()
        .min(2)
        .max(500)
        .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
        .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v)),
      consented: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('withdraw'),
      commandId: z.uuid(),
      linkId: z.uuid(),
      expectedVersion: version,
      reason: z.string().trim().min(10).max(500),
      acknowledged: z.literal(true),
    })
    .strict(),
]);
const page = {
  registrationId: z.uuid(),
  after: z.uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(25).default(25),
};
export class CustomerMissionShareService extends CustomerSessionBoundary {
  async command(input: unknown, subject?: string, issuer?: string) {
    const { action, commandId, ...payload } = customerMissionShareInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_mission_command($1,$2,$3) AS result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async choices(input: unknown, subject?: string, issuer?: string) {
    const v = z.object(page).strict().parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_mission_choices($1,$2,$3) AS result', [
            v.registrationId,
            v.after ?? null,
            v.pageSize,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async summaries(input: unknown, subject?: string, issuer?: string) {
    const v = z
      .object({ ...page, view: z.enum(['own', 'manage']) })
      .strict()
      .parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_mission_summaries($1,$2,$3,$4) AS result', [
            v.registrationId,
            v.view === 'manage',
            v.after ?? null,
            v.pageSize,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
