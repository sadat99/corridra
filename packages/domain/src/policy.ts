import { z } from 'zod';
import { classification, DomainError } from './index';
import { countryCode } from './geography';
export const dataRights = z
  .object({
    sourceId: z.uuid(),
    licence: z.string().min(3).max(200),
    permittedReuse: z.array(z.enum(['INTERNAL_REVIEW', 'PUBLICATION', 'AI_REVIEW'])),
    role: z.enum(['CONTROLLER', 'PROCESSOR', 'UNREVIEWED']),
    purpose: z.string().min(3).max(80),
    classification,
    jurisdictions: z.array(countryCode).min(1),
    subjectLocations: z.array(countryCode),
    processingLocations: z.array(countryCode).min(1),
    retentionUntil: z.iso.datetime({ offset: true }),
    legalHold: z.boolean(),
    aiPermission: z.enum(['DENY', 'REVIEW_REQUIRED']),
    transferStatus: z.enum(['UNREVIEWED', 'DENIED', 'APPROVED']),
    transferMechanism: z.string().min(3).max(200).nullable(),
  })
  .strict()
  .refine(
    (v) => v.transferStatus !== 'APPROVED' || v.transferMechanism !== null,
    'Approved mechanism required',
  );
export const aiRequest = z
  .object({
    tenantId: z.uuid(),
    sourceTenantId: z.uuid(),
    task: z.enum(['SUMMARIZE', 'EXTRACT', 'DRAFT']),
    providerApproved: z.boolean(),
    humanApproved: z.boolean(),
    routeReady: z.boolean(),
    requestedTools: z.array(z.enum(['READ_SCOPED_SOURCE', 'DRAFT_OUTPUT'])),
    allowedTools: z.array(z.enum(['READ_SCOPED_SOURCE', 'DRAFT_OUTPUT'])),
  })
  .strict();
// Trusted server policy input only. Provider/model output is never an authorization input.
export function authorizeAiTask(request: unknown, context: unknown, now = new Date()) {
  const r = aiRequest.parse(request),
    p = dataRights.parse(context);
  if (
    r.tenantId !== r.sourceTenantId ||
    !r.providerApproved ||
    !r.humanApproved ||
    !r.routeReady ||
    p.role === 'UNREVIEWED' ||
    p.aiPermission === 'DENY' ||
    p.transferStatus !== 'APPROVED' ||
    p.classification !== 'PUBLIC' ||
    !p.permittedReuse.includes('AI_REVIEW') ||
    Date.parse(p.retentionUntil) <= now.getTime() ||
    r.requestedTools.some((t) => !r.allowedTools.includes(t))
  )
    throw new DomainError('AI task denied by global data and authority policy');
  return { task: r.task, tools: r.requestedTools, outputAuthority: 'UNVERIFIED_DRAFT' as const };
}
export function authorizeContributorTask(
  input: {
    tenantId: string;
    taskTenantId: string;
    actorId: string;
    assigneeId: string;
    relationshipDisclosed: boolean;
    expiresAt: string;
  },
  now = new Date(),
) {
  if (
    input.tenantId !== input.taskTenantId ||
    input.actorId !== input.assigneeId ||
    !input.relationshipDisclosed ||
    Date.parse(input.expiresAt) <= now.getTime() ||
    !Number.isFinite(Date.parse(input.expiresAt))
  )
    throw new DomainError('Contributor task access denied');
}
