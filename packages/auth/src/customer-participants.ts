import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { sessionHash, type DatabasePool } from '@corridra/db';
import {
  CustomerSessionBoundary,
  type CustomerWorkspaceOptions,
  type CustomerSession,
} from './customer-session';
import { customerProgrammesEnabled } from './customer-programmes';
export function customerParticipantsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return customerProgrammesEnabled(env) && env.CORRIDRA_CUSTOMER_PARTICIPANTS_ENABLED === 'true';
}
// Counted in characters, as the database counts them, and refusing every control character it refuses (\p{Cc}).
const label = z
  .string()
  .trim()
  .max(120)
  .refine((v) => [...v].length >= 2, 'Enter a descriptive name or statement')
  .refine(customerLabelAllowed, 'Enter a descriptive name or statement')
  .refine((v) => !/\p{Cc}/u.test(v));
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
      recipientEmail: z
        .email()
        .max(254)
        .transform((value) => value.trim().toLowerCase())
        .optional(),
      acknowledged: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...command,
      ...scope,
      action: z.literal('emailInvitation'),
      invitationId: z.uuid(),
      token,
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
  // Correct a display label (CRUD gap G7): the participant for their own, or a workspace owner or admin.
  z
    .object({
      ...command,
      action: z.literal('label'),
      registrationId: z.uuid(),
      expectedVersion: z.number().int().min(0).max(100000),
      displayLabel: label,
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
export type ParticipantInvitationMail = (input: {
  id: string;
  recipientEmail: string;
  token: string;
}) => Promise<'sent' | 'not_sent' | 'off'>;
export class CustomerParticipantService extends CustomerSessionBoundary {
  constructor(
    runtime: DatabasePool,
    auth: DatabasePool,
    options: CustomerWorkspaceOptions,
    readSession: () => Promise<CustomerSession | null>,
    private invitationMail?: ParticipantInvitationMail,
  ) {
    super(runtime, auth, options, readSession);
  }

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
    if (value.action === 'emailInvitation') {
      const receipt = await this.transaction(
        async (db) =>
          (
            await db.query('SELECT customer.programme_invitation_email($1,$2,$3,$4) AS result', [
              value.invitationId,
              value.workspaceId,
              value.programmeId,
              sessionHash(value.token),
            ])
          ).rows[0].result,
        subject,
        issuer,
      );
      // The private code exists only in the visible request and provider message, never in stored events/inbox.
      let email: 'sent' | 'not_sent' | 'off' = 'not_sent';
      try {
        email =
          (await this.invitationMail?.({
            id: receipt.id,
            recipientEmail: receipt.recipientEmail,
            token: value.token,
          })) ?? 'not_sent';
      } catch {
        /* A failed email leaves the invitation usable. */
      }
      return {
        id: receipt.id,
        programmeId: receipt.programmeId,
        synthetic: receipt.synthetic,
        email,
      };
    }
    if (value.action === 'label') {
      return this.transaction(
        async (db) =>
          (
            await db.query('SELECT customer.programme_registration_label($1,$2,$3,$4) AS result', [
              value.commandId,
              value.registrationId,
              value.expectedVersion,
              value.displayLabel,
            ])
          ).rows[0].result,
        subject,
        issuer,
      );
    }
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
          ? {
              ...result,
              token: result.issued === true ? secret : null,
              canEmail: !!value.recipientEmail,
            }
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
