import { z } from 'zod';
import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { CustomerSessionBoundary } from './customer-session';
import { customerProgrammeTermsEnabled } from './customer-programme-terms';
import { customerMissionSharesEnabled } from './customer-mission-shares';
import { customerProgrammeContextEnabled } from './customer-programme-context';

export function customerProgrammeProjectionsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerProgrammeTermsEnabled(env) &&
    customerMissionSharesEnabled(env) &&
    customerProgrammeContextEnabled(env) &&
    env.CORRIDRA_CUSTOMER_PROGRAMME_PROJECTIONS_ENABLED === 'true'
  );
}
const version = z.number().int().min(0).max(1000000);
const command = { commandId: z.uuid(), expectedVersion: version, acknowledged: z.literal(true) };
export const projectionCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...command,
      action: z.literal('company'),
      registrationId: z.uuid(),
      shared: z.boolean(),
      profileId: z.uuid().optional(),
      profileVersion: z.number().int().positive().optional(),
      objective: z
        .string()
        .trim()
        .min(2)
        .max(500)
        .refine(customerLabelAllowed)
        .refine((v) => !/[\u0000-\u001f\u007f]/u.test(v))
        .optional(),
    })
    .strict()
    .refine(
      (v) =>
        !v.shared ||
        (v.profileId !== undefined && v.profileVersion !== undefined && v.objective !== undefined),
      'Review and confirm the company fields',
    ),
  z
    .object({ ...command, action: z.literal('meetings'), linkId: z.uuid(), shared: z.boolean() })
    .strict(),
  z
    .object({
      ...command,
      action: z.literal('schedule'),
      workspaceId: z.uuid(),
      programmeId: z.uuid(),
      taskId: z.uuid(),
      scheduled: z.boolean(),
      startsAt: z.string().datetime({ offset: true }).optional(),
      endsAt: z.string().datetime({ offset: true }).optional(),
      audience: z.enum(['ALL', 'SELECTED']).optional(),
      attendees: z.array(z.uuid()).max(10000).optional(),
    })
    .strict()
    .refine(
      (v) =>
        !v.scheduled ||
        (!!v.startsAt &&
          !!v.endsAt &&
          Date.parse(v.endsAt) > Date.parse(v.startsAt) &&
          !!v.audience &&
          !!v.attendees),
      'Choose activity times and attendees',
    ),
]);
const ownerQuery = z
  .object({
    workspaceId: z.uuid(),
    programmeId: z.uuid(),
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();
const ownQuery = z.object({ registrationId: z.uuid(), after: z.uuid().optional() }).strict();
export type SharedCompany = {
  name: string;
  countryCode: string;
  roles: string[];
  sectors: string[];
  objective: string;
  profileVersion: number;
  provenance: 'SELF_REPORTED';
};
export type ProgrammeProjection = {
  workspaceId: string;
  programmeId: string;
  expiresAt: string;
  sendsMessages: false;
  readiness: { activeParticipants: number; readyParticipants: number; definition: string };
  companies: {
    registrationId: string;
    label: string;
    company: SharedCompany | null;
    ready: boolean;
    missing: string[];
  }[];
  nextAfter: string | null;
  context: { version: number; startsAt: string; endsAt: string; timezone: string } | null;
  agenda: {
    taskId: string;
    title: string;
    status: string;
    version: number;
    scheduled: boolean;
    startsAt: string | null;
    endsAt: string | null;
    timezone: string | null;
    audience: 'ALL' | 'SELECTED';
    attendees: string[];
    needsReview: boolean | null;
  }[];
  conflicts: { left: string; right: string }[];
  meetings: {
    state: 'NOT_SHARED' | 'UNAVAILABLE' | 'AVAILABLE' | 'PARTIAL';
    sharedLinks: number;
    unavailableLinks: number;
    participantsSharing: number;
    scheduled: number | null;
    qualifiedHeld: number | null;
  };
};
export type OwnProgrammeProjection = {
  registrationId: string;
  expiresAt: string;
  active: boolean;
  sendsMessages: false;
  company: { version: number; shared: boolean; objective: string | null };
  profile: {
    id: string;
    version: number;
    name: string;
    countryCode: string;
    roles: string[];
    sectors: string[];
  } | null;
  missionLinks: {
    id: string;
    summary: string | null;
    version: number;
    shared: boolean;
    available: boolean;
  }[];
  nextLinkAfter: string | null;
};
export class CustomerProgrammeProjectionsService extends CustomerSessionBoundary {
  owner(input: unknown, subject?: string, issuer?: string) {
    const q = ownerQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: ProgrammeProjection }>(
            'SELECT customer.programme_projection_owner($1,$2,$3,$4) result',
            [q.workspaceId, q.programmeId, q.after ?? null, q.pageSize],
          )
        ).rows[0]!.result,
      subject,
      issuer,
    );
  }
  own(input: unknown, subject?: string, issuer?: string) {
    const q = ownQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: OwnProgrammeProjection }>(
            'SELECT customer.programme_projection_own($1,$2) result',
            [q.registrationId, q.after ?? null],
          )
        ).rows[0]!.result,
      subject,
      issuer,
    );
  }
  command(input: unknown, subject?: string, issuer?: string) {
    const { action, commandId, ...payload } = projectionCommand.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{
            result: {
              commandId: string;
              resourceId: string;
              version: number;
              replayed: boolean;
              expiresAt: string;
            };
          }>('SELECT customer.programme_projection_command($1,$2,$3) result', [
            commandId,
            action,
            JSON.stringify(payload),
          ])
        ).rows[0]!.result,
      subject,
      issuer,
    );
  }
}
