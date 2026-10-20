import { z } from 'zod';
import { withTenant, type DatabasePool, type RequestContext } from '@corridra/db';
import { CustomerSessionBoundary } from './customer-session';
import { customerWorkspacesEnabled } from './customer-workspaces';

export function customerOrganisationLinksEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    customerWorkspacesEnabled(env) && env.CORRIDRA_CUSTOMER_ORGANISATION_LINKS_ENABLED === 'true'
  );
}
// What a reviewed link means. It never verifies a person or a profile revision.
export const organisationLinkLabel =
  'Company link reviewed by Corridra staff from the evidence supplied (synthetic test)';
export const organisationLinkEvidenceKinds = [
  'REGISTRATION_STATEMENT',
  'WEBSITE_STATEMENT',
  'TRADE_REFERENCE_STATEMENT',
  'AUTHORISATION_STATEMENT',
] as const;
export const organisationLinkEvidenceLimit = 8;
const control = /[\u0000-\u001f\u007f]/u;
const syntheticText = (max: number) =>
  z
    .string()
    .trim()
    .min(11)
    .max(max)
    .regex(/^Synthetic /)
    .refine((v) => !control.test(v), 'Control characters are not allowed');
// Only reserved example hosts are accepted, so no real site can be entered as evidence.
const reservedUrl = z
  .string()
  .trim()
  .max(200)
  .regex(
    /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.(example|test|invalid)(\/[A-Za-z0-9._~/-]*)?$/,
    'Use a reserved example, test or invalid host',
  );
const staffText = z
  .string()
  .trim()
  .min(3)
  .max(1000)
  .refine((v) => !control.test(v), 'Control characters are not allowed');
export const customerOrganisationLinkQuery = z.object({ workspaceId: z.uuid() }).strict();
export const customerOrganisationLinkSearchQuery = z
  .object({ workspaceId: z.uuid(), q: z.string().trim().min(3).max(80) })
  .strict()
  .refine((v) => !control.test(v.q), 'Control characters are not allowed');
export const customerOrganisationLinkCommandInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('file'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      expectedProfileVersion: z.number().int().min(1).max(2147483646),
      kind: z.enum(['EXISTING', 'PROPOSED_NEW']),
      organisationId: z.uuid().nullable(),
      note: syntheticText(1000),
    })
    .strict()
    .refine((v) => (v.kind === 'EXISTING') === (v.organisationId !== null), {
      message: 'An existing organisation needs its id and a new one must not have one',
    }),
  z
    .object({
      action: z.literal('add_evidence'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      claimId: z.uuid(),
      expectedVersion: z.number().int().min(1).max(1000),
      evidenceKind: z.enum(organisationLinkEvidenceKinds),
      statement: syntheticText(1000),
      url: reservedUrl.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('withdraw'),
      commandId: z.uuid(),
      workspaceId: z.uuid(),
      claimId: z.uuid(),
      expectedVersion: z.number().int().min(1).max(1000),
    })
    .strict(),
]);
export type CustomerOrganisationLinkStatus =
  'none' | 'pending' | 'needs_evidence' | 'approved' | 'rejected';
export type CustomerOrganisationLinkView = {
  workspaceId: string;
  expiresAt: string;
  canEdit: boolean;
  commandId?: string;
  status: CustomerOrganisationLinkStatus;
  currentProfileVersion: number;
  canFile: boolean;
  link: null | {
    organisation: { name: string; country: string };
    linkedAt: string;
    reviewedProfileVersion: number;
    profileChanged: boolean;
    label: string;
    reason?: string | null;
  };
  claim: null | {
    state: 'pending' | 'needs_evidence' | 'rejected';
    awaitingCreation: boolean;
    kind: 'EXISTING' | 'PROPOSED_NEW';
    filedAt: string;
    profileVersion: number;
    profileChanged: boolean;
    id?: string;
    version?: number;
    note?: string;
    evidenceCount?: number;
    evidence?: {
      id: string;
      kind: (typeof organisationLinkEvidenceKinds)[number];
      statement: string;
      url: string | null;
      addedAt: string;
    }[];
    history?: {
      seq: number;
      kind: string;
      state: string;
      at: string;
      by: 'customer' | 'staff';
      reason: string | null;
    }[];
    decision?: { kind: string; reason: string; at: string } | null;
    target?: { name: string; country: string } | null;
    canAddEvidence?: boolean;
    canWithdraw?: boolean;
  };
};
export type CustomerOrganisationLinkOverview = {
  expiresAt: string;
  workspaces: {
    workspaceId: string;
    status: CustomerOrganisationLinkStatus;
    organisationName: string | null;
  }[];
};
export type CustomerOrganisationLinkSearch = {
  workspaceId: string;
  expiresAt: string;
  organisations: { id: string; name: string; country: string }[];
};

// Server-only: the actual current provider session decides who is acting.
export class CustomerOrganisationLinkService extends CustomerSessionBoundary {
  async view(input: unknown, subject?: string, issuer?: string) {
    const { workspaceId } = customerOrganisationLinkQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerOrganisationLinkView }>(
            'SELECT customer.organisation_link_view($1) AS result',
            [workspaceId],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async overview(subject?: string, issuer?: string) {
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerOrganisationLinkOverview }>(
            'SELECT customer.organisation_link_overview() AS result',
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async search(input: unknown, subject?: string, issuer?: string) {
    const { workspaceId, q } = customerOrganisationLinkSearchQuery.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerOrganisationLinkSearch }>(
            'SELECT customer.organisation_link_search($1,$2) AS result',
            [workspaceId, q],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
  async command(input: unknown, subject?: string, issuer?: string) {
    const { action, commandId, ...payload } = customerOrganisationLinkCommandInput.parse(input);
    return this.transaction(
      async (db) =>
        (
          await db.query<{ result: CustomerOrganisationLinkView }>(
            'SELECT customer.organisation_link_command($1,$2,$3) AS result',
            [commandId, action, JSON.stringify(payload)],
          )
        ).rows[0].result,
      subject,
      issuer,
    );
  }
}

export const staffOrganisationLinkQueueQuery = z
  .object({
    scope: z.enum(['open', 'closed']).default('open'),
    after: z.uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const staffOrganisationLinkDecisionInput = z
  .object({
    commandId: z.uuid(),
    claimId: z.uuid(),
    expectedVersion: z.number().int().min(1).max(1000),
    decision: z.enum(['approve', 'approve_creation', 'request_evidence', 'reject', 'revoke']),
    reason: staffText,
    internalNote: staffText.nullable(),
    organisationId: z.uuid().nullable(),
    shareConfirmed: z.boolean(),
  })
  .strict()
  .refine((v) => (v.decision === 'approve') === (v.organisationId !== null), {
    message: 'Approving needs an organisation and no other decision takes one',
  });
export type StaffOrganisationLinkCandidates = {
  organisations: {
    id: string;
    name: string;
    country: string;
    reasons: string[];
    linkedWorkspaces: number;
  }[];
  workspaces: {
    claimId: string;
    workspaceId: string;
    state: string;
    legalName: string;
    country: string;
    reasons: string[];
  }[];
};
export type StaffOrganisationLinkQueue = {
  scope: 'open' | 'closed';
  nextAfter: string | null;
  synthetic: true;
  items: {
    claimId: string;
    workspaceId: string;
    workspaceName: string;
    kind: 'EXISTING' | 'PROPOSED_NEW';
    state: string;
    version: number;
    filedAt: string;
    legalName: string;
    country: string;
    evidenceCount: number;
    candidateCount: number;
  }[];
};
export type StaffOrganisationLinkReview = {
  claimId: string;
  workspaceId: string;
  workspaceName: string;
  expiresAt: string;
  kind: 'EXISTING' | 'PROPOSED_NEW';
  state: string;
  version: number;
  filedAt: string;
  note: string;
  profile: {
    version: number;
    currentVersion: number;
    legalName: string;
    countryCode: string;
    website: string | null;
    summary: string;
    commercialRoles: string[];
    sectors: string[];
    sizeBand: string;
  };
  chosenOrganisation: { id: string; name: string; country: string } | null;
  activeLink: null | {
    claimId: string;
    organisation: { id: string; name: string; country: string };
    linkedAt: string;
    shared: boolean;
  };
  evidence: { id: string; kind: string; statement: string; url: string | null; addedAt: string }[];
  history: {
    seq: number;
    kind: string;
    state: string;
    at: string;
    by: 'customer' | 'staff';
    byYou?: boolean | null;
    reason: string | null;
    internalNote: string | null;
  }[];
  candidates: StaffOrganisationLinkCandidates;
  decisions: ('approve' | 'approve_creation' | 'request_evidence' | 'reject' | 'revoke')[];
};
export type StaffOrganisationLinkOutcome = {
  claimId: string;
  commandId: string;
  decision: string;
  state: string;
  version: number;
  shared: boolean;
};

// Protected staff review. It reuses the existing operator sign-in, the reviewer roles (owner, admin, reviewer)
// and the fresh-authenticator rule of `trust.verify`; the database checks the same rules again.
export class StaffOrganisationLinkService {
  constructor(private pool: DatabasePool) {}
  async queue(ctx: RequestContext, input: unknown) {
    const q = staffOrganisationLinkQueueQuery.parse(input);
    return withTenant(this.pool, ctx, 'trust.verify', async ({ db }) => {
      return (
        await db.query<{ result: StaffOrganisationLinkQueue }>(
          'SELECT app.customer_organisation_link_queue($1,$2,$3) AS result',
          [q.scope, q.after ?? null, q.pageSize],
        )
      ).rows[0].result;
    });
  }
  async review(ctx: RequestContext, claimId: string) {
    z.uuid().parse(claimId);
    return withTenant(this.pool, ctx, 'trust.verify', async ({ db }) => {
      return (
        await db.query<{ result: StaffOrganisationLinkReview }>(
          'SELECT app.customer_organisation_link_review($1) AS result',
          [claimId],
        )
      ).rows[0].result;
    });
  }
  async decide(ctx: RequestContext, input: unknown) {
    const { commandId, ...payload } = staffOrganisationLinkDecisionInput.parse(input);
    return withTenant(this.pool, ctx, 'trust.verify', async ({ db }) => {
      return (
        await db.query<{ result: StaffOrganisationLinkOutcome }>(
          'SELECT app.customer_organisation_link_decide($1,$2) AS result',
          [commandId, JSON.stringify(payload)],
        )
      ).rows[0].result;
    });
  }
}
