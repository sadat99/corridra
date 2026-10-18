import { z } from 'zod';
import { delegationContextInput } from '@corridra/domain/experience';
import { CustomerSessionBoundary } from './customer-session';
import { customerParticipantsEnabled } from './customer-participants';
export function customerProgrammeContextEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerParticipantsEnabled(env) && env.CORRIDRA_CUSTOMER_PROGRAMME_CONTEXT_ENABLED === 'true'
  );
}
const syntheticText = z
  .string()
  .trim()
  .min(11)
  .max(1000)
  .regex(/^Synthetic /)
  .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v));
export const customerProgrammeContextInput = z
  .object({
    commandId: z.uuid(),
    programmeId: z.uuid(),
    marketCode: delegationContextInput.shape.marketCode,
    startsAt: delegationContextInput.shape.startsAt,
    endsAt: delegationContextInput.shape.endsAt,
    timezone: delegationContextInput.shape.timezone,
    reason: delegationContextInput.shape.reason,
    workspaceId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    organiser: syntheticText,
    purpose: syntheticText,
    shared: z.boolean(),
    acknowledged: z.literal(true),
  })
  .strict()
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), 'End must follow start');
export const customerProgrammeContextQuery = z.union([
  z.object({ workspaceId: z.uuid(), programmeId: z.uuid() }).strict(),
  z.object({ registrationId: z.uuid() }).strict(),
]);
export class CustomerProgrammeContextService extends CustomerSessionBoundary {
  async command(input: unknown, subject?: string, issuer?: string) {
    const {
      commandId,
      workspaceId,
      programmeId,
      expectedVersion,
      shared,
      acknowledged,
      ...details
    } = customerProgrammeContextInput.parse(input);
    void acknowledged;
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_context_command($1,$2,$3,$4,$5,$6) AS result', [
            commandId,
            workspaceId,
            programmeId,
            expectedVersion,
            JSON.stringify(details),
            shared,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async view(input: unknown, subject?: string, issuer?: string) {
    const v = customerProgrammeContextQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_context_view($1,$2,$3) AS result', [
            'workspaceId' in v ? v.workspaceId : null,
            'programmeId' in v ? v.programmeId : null,
            'registrationId' in v ? v.registrationId : null,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
