import { z } from 'zod';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';

export function customerOrganisationProfilesEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerWorkspacesEnabled(env) && env.CORRIDRA_CUSTOMER_ORGANISATION_PROFILES_ENABLED === 'true'
  );
}
export const organisationCommercialRoles = [
  'BUYER',
  'SELLER',
  'SUPPLIER',
  'MANUFACTURER',
  'DISTRIBUTOR',
  'ORGANISER',
] as const;
export const organisationSizeBands = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
const control = /[\u0000-\u001f\u007f]/u;
const syntheticText = (max: number) =>
  z
    .string()
    .trim()
    .min(11)
    .max(max)
    .regex(/^Synthetic /)
    .refine((v) => !control.test(v), 'Control characters are not allowed');
// Only reserved example hosts are accepted, so no real company site can be entered.
const reservedWebsite = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(\/[A-Za-z0-9._~/-]*)?$/,
    'Use a reserved example, test or invalid host',
  );
export const customerOrganisationProfileDetails = z
  .object({
    legalName: syntheticText(200),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    website: reservedWebsite.nullable(),
    commercialRoles: z
      .array(z.enum(organisationCommercialRoles))
      .min(1)
      .max(6)
      .refine((roles) => new Set(roles).size === roles.length, 'Roles must be unique'),
    sectors: z
      .array(
        z
          .string()
          .trim()
          .min(2)
          .max(60)
          .refine((v) => !control.test(v), 'Control characters are not allowed'),
      )
      .max(10)
      .refine(
        (sectors) => new Set(sectors.map((s) => s.toLowerCase())).size === sectors.length,
        'Sectors must be unique',
      ),
    sizeBand: z.enum(organisationSizeBands),
    summary: syntheticText(1000),
  })
  .strict();
export const customerOrganisationProfileInput = customerOrganisationProfileDetails
  .extend({
    commandId: z.uuid(),
    workspaceId: z.uuid(),
    expectedVersion: z.number().int().min(0).max(2147483646),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(1000)
      .refine((v) => !control.test(v), 'Control characters are not allowed'),
    acknowledged: z.literal(true),
  })
  .strict();
export const customerOrganisationProfileQuery = z.object({ workspaceId: z.uuid() }).strict();
export const customerOrganisationProfileHistoryQuery = z
  .object({
    workspaceId: z.uuid(),
    beforeVersion: z.coerce.number().int().min(1).max(2147483646).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CustomerOrganisationProfileView = {
  workspaceId: string;
  expiresAt: string;
  organisationId: null;
  canonicalLinked: false;
  provenance: 'SELF_REPORTED';
  verified: false;
  canEdit: boolean;
  currentVersion: number;
  commandId?: string;
  superseded?: boolean;
  profile:
    | (z.infer<typeof customerOrganisationProfileDetails> & {
        version: number;
        updatedAt: string;
        reason?: string;
      })
    | null;
};
export type CustomerOrganisationProfileHistory = {
  workspaceId: string;
  expiresAt: string;
  revisions: {
    version: number;
    reason: string;
    createdAt: string;
    byYou: boolean;
    provenance: 'SELF_REPORTED';
  }[];
  nextBefore: number | null;
};
export class CustomerOrganisationProfileService extends CustomerSessionBoundary {
  async view(input: unknown, subject?: string, issuer?: string) {
    const { workspaceId } = customerOrganisationProfileQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerOrganisationProfileView }>(
            'SELECT customer.organisation_profile_view($1) AS result',
            [workspaceId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async command(input: unknown, subject?: string, issuer?: string) {
    const { commandId, workspaceId, expectedVersion, reason, acknowledged, ...details } =
      customerOrganisationProfileInput.parse(input);
    void acknowledged;
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerOrganisationProfileView }>(
            'SELECT customer.organisation_profile_command($1,$2,$3,$4,$5) AS result',
            [commandId, workspaceId, expectedVersion, JSON.stringify(details), reason],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async history(input: unknown, subject?: string, issuer?: string) {
    const { workspaceId, beforeVersion, pageSize } =
      customerOrganisationProfileHistoryQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerOrganisationProfileHistory }>(
            'SELECT customer.organisation_profile_history($1,$2,$3) AS result',
            [workspaceId, beforeVersion ?? null, pageSize],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}
