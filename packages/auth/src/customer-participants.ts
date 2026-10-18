import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sessionHash } from '@corridra/db';
import { CustomerSessionBoundary } from './customer-session';
import { customerProgrammesEnabled } from './customer-programmes';
export function customerParticipantsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerProgrammesEnabled(env) && env.CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED === 'true';
}
const label = z
  .string()
  .trim()
  .min(11)
  .max(120)
  .regex(/^Synthetic /)
  .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v));
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const command = { commandId: z.uuid() };
const scope = { workspaceId: z.uuid(), programmeId: z.uuid() };
const reason = z.string().trim().min(10).max(500);
export const customerParticipantInput = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      ...scope,
      action: z.literal('invite'),
      label,
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('accept'),
      token,
      programmeId: z.uuid(),
      displayLabel: label,
      consented: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...command,
      ...scope,
      action: z.literal('revoke'),
      kind: z.enum(['invitation', 'registration']),
      targetId: z.uuid(),
      reason,
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('withdraw'),
      registrationId: z.uuid(),
      reason,
      acknowledged: z.literal(true),
    })
    .strict(),
]);
const page = z
  .object({
    ...scope,
    invitationAfter: z.uuid().optional(),
    registrationAfter: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(25).default(25),
  })
  .strict();
const ownPage = z
  .object({
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(25).default(25),
  })
  .strict();
export class CustomerParticipantService extends CustomerSessionBoundary {
  async preview(input: unknown, subject?: string, issuer?: string) {
    const value = z.object({ token }).strict().parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_participant_preview($1) AS result', [
            sessionHash(value.token),
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async command(input: unknown, subject?: string, issuer?: string) {
    const value = customerParticipantInput.parse(input);
    return this.transaction(
      async (db) => {
        const secret = value.action === 'invite' ? randomBytes(32).toString('base64url') : null;
        const { commandId, action, ...rest } = value;
        let payload: Record<string, unknown> = { ...rest };
        if (action === 'invite') payload = { ...payload, tokenHash: sessionHash(secret!) };
        if (action === 'accept') {
          const { token: raw, ...safe } = payload;
          payload = { ...safe, tokenHash: sessionHash(raw as string) };
        }
        const result = (
          await db.query('SELECT customer.programme_participant_command($1,$2,$3) AS result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0].result;
        return action === 'invite'
          ? { ...result, token: result.issued === true ? secret : null }
          : result;
      },
      subject,
      issuer,
    );
  }
  async list(input: unknown, subject?: string, issuer?: string) {
    const v = page.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.programme_participants($1,$2,$3,$4,$5) AS result', [
            v.workspaceId,
            v.programmeId,
            v.invitationAfter ?? null,
            v.registrationAfter ?? null,
            v.pageSize,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async own(input: unknown = {}, subject?: string, issuer?: string) {
    const v = ownPage.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query('SELECT customer.own_programme_registrations($1,$2) AS result', [
            v.after ?? null,
            v.pageSize,
          ])
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
