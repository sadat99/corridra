import { customerProvenanceAllowed } from '@corridra/domain/customer-input-mode';
import { z } from 'zod';
import { ReplyError } from './load-reason';
import { privateViewMaxMs } from './server-clock';

// The one place that reads the replies of the company link functions in the browser. The staff screen and the
// customer screens import these checks, and the database tests parse real function output through the same code,
// so a key added in SQL that a check here refuses shows up as a failing test.

// What the database writes in place of text that staff hid at the customer's request. A screen shows it once, without a
// label or a bracket added around it.
export const hiddenText = 'This text is hidden.';
export const isHidden = (text: string | null | undefined) => text === hiddenText;

export const linkStatuses = ['none', 'pending', 'needs_evidence', 'approved', 'rejected'] as const;
export type LinkStatus = (typeof linkStatuses)[number];

// ---- Staff queue, review and decision ----
const org = z.object({ id: z.uuid(), name: z.string(), country: z.string() });
export const staffQueueSchema = z
  .object({
    scope: z.enum(['open', 'closed']),
    synthetic: z.boolean().refine(customerProvenanceAllowed),
    nextAfter: z.uuid().nullable(),
    items: z
      .array(
        z
          .object({
            claimId: z.uuid(),
            workspaceId: z.uuid(),
            workspaceName: z.string(),
            kind: z.enum(['EXISTING', 'PROPOSED_NEW']),
            state: z.string(),
            version: z.number().int(),
            filedAt: z.iso.datetime({ offset: true }),
            legalName: z.string(),
            country: z.string(),
            redacted: z.boolean(),
            evidenceCount: z.number().int(),
            candidateCount: z.number().int(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export const staffDecisions = [
  'approve',
  'approve_creation',
  'request_evidence',
  'reject',
  'revoke',
] as const;
export const staffReviewSchema = z
  .object({
    claimId: z.uuid(),
    workspaceId: z.uuid(),
    workspaceName: z.string(),
    expiresAt: z.iso.datetime({ offset: true }),
    kind: z.enum(['EXISTING', 'PROPOSED_NEW']),
    state: z.string(),
    version: z.number().int(),
    filedAt: z.iso.datetime({ offset: true }),
    note: z.string(),
    profile: z
      .object({
        version: z.number().int(),
        currentVersion: z.number().int(),
        legalName: z.string(),
        countryCode: z.string(),
        website: z.string().nullable(),
        summary: z.string(),
        commercialRoles: z.array(z.string()),
        sectors: z.array(z.string()),
        sizeBand: z.string(),
      })
      .strict(),
    chosenOrganisation: org.nullable(),
    activeLink: z
      .object({
        claimId: z.uuid(),
        organisation: org,
        linkedAt: z.iso.datetime({ offset: true }),
        shared: z.boolean(),
      })
      .nullable(),
    evidence: z.array(
      z.object({
        id: z.uuid(),
        kind: z.string(),
        statement: z.string(),
        url: z.string().nullable(),
        addedAt: z.string(),
      }),
    ),
    history: z.array(
      z.object({
        seq: z.number().int(),
        kind: z.string(),
        state: z.string(),
        at: z.string(),
        by: z.enum(['customer', 'staff']),
        byYou: z.boolean().nullable().optional(),
        reason: z.string().nullable(),
        internalNote: z.string().nullable(),
      }),
    ),
    candidates: z
      .object({
        organisations: z.array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            country: z.string(),
            reasons: z.array(z.string()),
            linkedWorkspaces: z.number().int(),
          }),
        ),
        workspaces: z.array(
          z.object({
            claimId: z.uuid(),
            workspaceId: z.uuid(),
            state: z.string(),
            legalName: z.string(),
            country: z.string(),
            reasons: z.array(z.string()),
          }),
        ),
      })
      .strict(),
    decisions: z.array(z.enum(staffDecisions)),
    redacted: z.boolean(),
  })
  .strict();
export const staffOutcomeSchema = z
  .object({
    claimId: z.uuid(),
    commandId: z.uuid(),
    decision: z.string(),
    state: z.string(),
    version: z.number().int(),
    shared: z.boolean(),
  })
  .strict();

// ---- Customer view, command result, overview and search ----
export type LinkOrganisation = { name: string; country: string };
export type LinkClaim = {
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
  evidence?: { id: string; kind: string; statement: string; url: string | null }[];
  history?: { seq: number; kind: string; at: string; by: string; reason: string | null }[];
  decision?: { kind: string; reason: string; at: string } | null;
  target?: LinkOrganisation | null;
  canAddEvidence?: boolean;
  canWithdraw?: boolean;
  // Present, and true, only when staff hid the text of this request. The text fields then read "This text is hidden."
  redacted?: boolean;
};
export type LinkView = {
  workspaceId: string;
  expiresAt: string;
  canEdit: boolean;
  commandId?: string;
  status: LinkStatus;
  currentProfileVersion: number;
  canFile: boolean;
  link: null | {
    // Null when the organisation is not shown to this workspace (it belongs to the other side).
    organisation: LinkOrganisation | null;
    linkedAt: string;
    reviewedProfileVersion: number;
    profileChanged: boolean;
    label: string;
    reason?: string | null;
  };
  claim: LinkClaim | null;
};
export type LinkFound = { id: string; name: string; country: string };
export type LinkOverview = Record<string, { status: LinkStatus; organisationName: string | null }>;

export function parseLinkView(value: unknown, workspaceId: string): LinkView {
  const v = value as LinkView;
  if (!v || typeof v !== 'object') throw new ReplyError('reply empty');
  const expires = Date.parse(v.expiresAt);
  const checks: [string, boolean][] = [
    ['workspace', v.workspaceId !== workspaceId],
    ['status', !(linkStatuses as readonly string[]).includes(v.status)],
    ['can edit', typeof v.canEdit !== 'boolean'],
    ['can file', typeof v.canFile !== 'boolean'],
    ['version', !Number.isInteger(v.currentProfileVersion)],
    ['expiry missing', !Number.isFinite(expires)],
    ['expiry past', expires <= Date.now()],
    ['expiry far', expires > Date.now() + privateViewMaxMs],
    ['claim', v.claim !== null && typeof v.claim !== 'object'],
    [
      'link',
      v.link !== null &&
        (typeof v.link !== 'object' ||
          (v.link.organisation !== null && typeof v.link.organisation?.name !== 'string')),
    ],
    [
      'hidden flag',
      v.claim !== null && v.claim?.redacted !== undefined && v.claim.redacted !== true,
    ],
  ];
  const failed = checks.find(([, bad]) => bad);
  if (failed) throw new ReplyError(`reply ${failed[0]}`);
  return v;
}

export function parseLinkOverview(body: unknown): LinkOverview {
  const workspaces = (body as { workspaces?: unknown } | null)?.workspaces;
  if (
    !Array.isArray(workspaces) ||
    !workspaces.every(
      (w) =>
        typeof w?.workspaceId === 'string' &&
        (linkStatuses as readonly string[]).includes(w.status) &&
        (w.organisationName === null || typeof w.organisationName === 'string'),
    )
  )
    throw Error('overview');
  return Object.fromEntries(
    (
      workspaces as { workspaceId: string; status: LinkStatus; organisationName: string | null }[]
    ).map((w) => [
      w.workspaceId,
      { status: w.status, organisationName: w.organisationName ?? null },
    ]),
  );
}

export function parseLinkSearch(body: unknown, workspaceId: string): LinkFound[] {
  const answer = body as { workspaceId?: unknown; organisations?: unknown } | null;
  if (answer?.workspaceId !== workspaceId || !Array.isArray(answer.organisations))
    throw Error('search');
  return answer.organisations as LinkFound[];
}
