import { z } from 'zod';
export const classification = z.enum([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'PERSONAL',
  'SENSITIVE_COMMERCIAL',
  'HIGHLY_RESTRICTED',
]);
export const role = z.enum(['owner', 'admin', 'operator', 'reviewer', 'viewer']);
export type Role = z.infer<typeof role>;
export const evidenceStatus = z.enum([
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
]);
export type EvidenceStatus = z.infer<typeof evidenceStatus>;
const transitions: Record<EvidenceStatus, readonly EvidenceStatus[]> = {
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['EXPIRED', 'SUPERSEDED'],
  REJECTED: [],
  EXPIRED: ['SUPERSEDED'],
  SUPERSEDED: [],
};
export function assertTransition(from: EvidenceStatus, to: EvidenceStatus) {
  if (!transitions[from].includes(to)) throw new DomainError('Invalid evidence transition', 409);
}
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}
export const purpose = z.enum([
  'synthetic_validation',
  'commercial_qualification',
  'evidence_review',
]);
export const provenance = z.object({
  classification,
  purpose,
  retentionUntil: z.iso.datetime({ offset: true }),
  aiPolicy: z.enum(['DENY', 'PUBLIC_ONLY', 'REVIEW_REQUIRED']),
});
export const sourceInput = provenance
  .extend({
    kind: z.enum(['self_declaration', 'document', 'observation', 'public_record']),
    locator: z.string().min(1).max(500),
    observedAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (v) => new Date(v.retentionUntil) > new Date(v.observedAt),
    'Retention must follow observation',
  );
export const claimInput = z.object({
  sourceId: z.uuid(),
  statement: z.string().trim().min(1).max(2000),
});
export const permissions = {
  'delivery.read': ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  'delivery.manage': ['owner', 'admin', 'operator'],
  'delivery.share': ['owner', 'admin'],
  'opportunities.read': ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  'opportunities.manage': ['owner', 'admin', 'operator'],
  'opportunities.accounting': ['owner', 'admin'],
  'communications.read': ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  'communications.manage': ['owner', 'admin', 'operator'],
  'communications.approve': ['owner', 'admin'],
  'meetings.read': ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  'meetings.manage': ['owner', 'admin', 'operator'],
  'research.read': ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  'research.manage': ['owner', 'admin', 'operator'],
  'research.resolve': ['owner', 'admin', 'reviewer'],
  'missions.read': ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  'missions.manage': ['owner', 'admin', 'operator'],
  'trust.read': ['owner', 'admin', 'operator', 'reviewer', 'viewer'],
  'trust.write': ['owner', 'admin', 'operator', 'reviewer'],
  'trust.verify': ['owner', 'admin', 'reviewer'],
  'members.manage': ['owner'],
  'config.manage': ['owner'],
  'audit.read': ['owner', 'admin'],
  // Opening a read-only preview of what a customer, delegate or supplier sees. Always logged.
  'viewas.open': ['owner', 'admin'],
} satisfies Record<string, Role[]>;
export type Permission = keyof typeof permissions;
export function authorize(role: Role, permission: Permission) {
  if (!(permissions[permission] as Role[]).includes(role)) throw new DomainError('Access denied');
}
