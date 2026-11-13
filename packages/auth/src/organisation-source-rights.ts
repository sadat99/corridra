import { z } from 'zod';
import {
  withTenant,
  type DatabaseClient,
  type DatabasePool,
  type RequestContext,
} from '@corridra/db';
import { DomainError, type Permission } from '@corridra/domain';
import { organisationSourceTypes } from '@corridra/domain/counterparties';

// ADR-079 slice B: the staff-only service over the 0021 functions (source rights, takedown, claim redaction and the
// closed-claims lookup). None of it is behind the customer link switch, and none of it reaches a customer. Authority is
// checked here by role and again in the database, which also enforces the fresh authenticator check for link staff.
export const organisationUnavailable = 'Organisation unavailable';
export const companyLinkRequestUnavailable = 'Company link request unavailable';
const control = /[\u0000-\u001f\u007f]/u;
const sentence = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => v === v.trim(), 'Remove leading and trailing spaces')
    .refine((v) => !control.test(v), 'Control characters are not allowed');
export const organisationSourceRightsAdjustInput = z
  .object({
    commandId: z.uuid(),
    organisationId: z.uuid(),
    sourceType: z.enum(organisationSourceTypes),
    reason: sentence(3, 1000),
  })
  .strict();
export const organisationSuppressionInput = z
  .object({
    commandId: z.uuid(),
    organisationId: z.uuid(),
    state: z.enum(['hidden', 'shown']),
    reason: sentence(3, 1000),
    reference: sentence(3, 120),
  })
  .strict();
export const organisationLinkRedactionInput = z
  .object({
    commandId: z.uuid(),
    claimId: z.uuid(),
    confirmClaimId: z.uuid(),
    reason: sentence(3, 1000),
    reference: sentence(3, 120),
  })
  .strict();
export type OrganisationSourceRightsRecord = {
  version: number;
  sourceType: (typeof organisationSourceTypes)[number];
  basisNote: string;
  personalNameFlag: boolean;
  warnings: string[];
  reviewBy: string;
  reason: string | null;
  recordedAt: string;
};
export type OrganisationSourceRightsAdjusted = OrganisationSourceRightsRecord & {
  organisationId: string;
  commandId: string;
};
export type OrganisationSourceRightsRead =
  | { organisationId: string; status: 'unrecorded' }
  | {
      organisationId: string;
      status: 'recorded';
      current: OrganisationSourceRightsRecord;
      history: OrganisationSourceRightsRecord[];
    };
export type OrganisationSuppressionOutcome = {
  organisationId: string;
  commandId: string;
  state: 'hidden' | 'shown';
  version: number;
};
export type OrganisationLinkRedactionOutcome = {
  claimId: string;
  commandId: string;
  redacted: true;
};
export type OrganisationLinkClosedClaims = {
  claims: {
    claimId: string;
    state: string;
    version: number;
    createdAt: string;
    updatedAt: string | null;
    redacted: boolean;
  }[];
};

// A refusal never says which part failed. A caller without the role, in another workspace, on the other side or asking for
// an unknown record all get the same status and words. The step-up refusal is kept: it names the caller's own session, not a
// record. The owner or admin sentence is kept too, because it only tells a signed-in reviewer what their own role may do.
function neutral(error: unknown, words: string): unknown {
  if (error instanceof DomainError) {
    return error.status === 403 && !error.code ? new DomainError(words, 403) : error;
  }
  const refused = error as { code?: string; message?: string };
  if (refused.code !== '42501') return error;
  return refused.message?.startsWith('Owner or admin required')
    ? new DomainError(refused.message, 403)
    : new DomainError(words, 403);
}

export class StaffOrganisationCatalogueService {
  constructor(private pool: DatabasePool) {}
  private async run<T>(
    ctx: RequestContext,
    permission: Permission,
    words: string,
    work: (db: DatabaseClient) => Promise<T>,
  ) {
    try {
      return await withTenant(this.pool, ctx, permission, ({ db }) => work(db));
    } catch (error) {
      throw neutral(error, words);
    }
  }
  async adjustRights(ctx: RequestContext, input: unknown) {
    const { commandId, ...payload } = organisationSourceRightsAdjustInput.parse(input);
    return this.run(ctx, 'research.manage', organisationUnavailable, async (db) => {
      return (
        await db.query<{ result: OrganisationSourceRightsAdjusted }>(
          'SELECT app.adjust_organisation_source_rights($1,$2) AS result',
          [commandId, JSON.stringify(payload)],
        )
      ).rows[0].result;
    });
  }
  async readRights(ctx: RequestContext, organisationId: string) {
    z.uuid().parse(organisationId);
    return this.run(ctx, 'research.manage', organisationUnavailable, async (db) => {
      return (
        await db.query<{ result: OrganisationSourceRightsRead }>(
          'SELECT app.organisation_source_rights_read($1) AS result',
          [organisationId],
        )
      ).rows[0].result;
    });
  }
  async suppress(ctx: RequestContext, input: unknown) {
    const { commandId, ...payload } = organisationSuppressionInput.parse(input);
    return this.run(ctx, 'trust.verify', organisationUnavailable, async (db) => {
      return (
        await db.query<{ result: OrganisationSuppressionOutcome }>(
          'SELECT app.customer_organisation_suppress($1,$2) AS result',
          [commandId, JSON.stringify(payload)],
        )
      ).rows[0].result;
    });
  }
  async redact(ctx: RequestContext, input: unknown) {
    const { commandId, ...payload } = organisationLinkRedactionInput.parse(input);
    return this.run(ctx, 'trust.verify', companyLinkRequestUnavailable, async (db) => {
      return (
        await db.query<{ result: OrganisationLinkRedactionOutcome }>(
          'SELECT app.customer_organisation_link_redact($1,$2) AS result',
          [commandId, JSON.stringify(payload)],
        )
      ).rows[0].result;
    });
  }
  async closedClaims(ctx: RequestContext, workspaceId: string) {
    z.uuid().parse(workspaceId);
    return this.run(ctx, 'trust.verify', companyLinkRequestUnavailable, async (db) => {
      return (
        await db.query<{ result: OrganisationLinkClosedClaims }>(
          'SELECT app.customer_organisation_link_closed_claims($1) AS result',
          [workspaceId],
        )
      ).rows[0].result;
    });
  }
}
