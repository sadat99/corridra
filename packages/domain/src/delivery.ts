import { z } from 'zod';
export const programmeInput = z.object({
  commandId: z.uuid(),
  name: z.string().trim().min(3).max(160),
  reportingPurpose: z.string().trim().min(10).max(500),
});
export const publicationInput = z.object({
  commandId: z.uuid(),
  missionId: z.uuid(),
  title: z.string().trim().min(3).max(160),
  company: z.string().trim().min(2).max(160),
  objective: z.string().trim().min(3).max(500),
  brief: z.string().trim().min(10).max(2000),
  nextAction: z.string().trim().min(3).max(300),
  dueAt: z.iso.datetime({ offset: true }),
  meetings: z
    .array(
      z.object({
        id: z.uuid(),
        version: z.int().positive(),
        label: z.string().trim().min(3).max(160),
      }),
    )
    .max(50),
  opportunityIds: z.array(z.uuid()).max(100),
  includeFinancials: z.boolean(),
  approved: z.literal(true),
});
export const shareInput = z
  .object({
    commandId: z.uuid(),
    programmeId: z.uuid().nullable(),
    publicationIds: z
      .array(z.uuid())
      .min(1)
      .max(1000)
      .refine((v) => new Set(v).size === v.length),
    audience: z.enum(['CLIENT_PROGRESS', 'INSTITUTION_REPORT']),
    purpose: z.string().trim().min(10).max(500),
    expiresAt: z.iso.datetime({ offset: true }),
    allowExport: z.boolean(),
    includeDelegation: z.boolean().default(false),
    approved: z.literal(true),
  })
  .superRefine((v, ctx) => {
    if (
      v.audience === 'CLIENT_PROGRESS' &&
      (v.programmeId || v.publicationIds.length !== 1 || v.allowExport || v.includeDelegation)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Client links grant one mission without cohort exports',
      });
    if (v.audience === 'INSTITUTION_REPORT' && !v.programmeId)
      ctx.addIssue({ code: 'custom', message: 'Choose a programme for institutional reporting' });
  });
export const requestInput = z.object({
  commandId: z.uuid(),
  publicationId: z.uuid(),
  ownerId: z.uuid(),
  title: z.string().trim().min(3).max(160),
  instructions: z.string().trim().min(10).max(1000),
  dueAt: z.iso.datetime({ offset: true }),
});
export const publicDeliveryInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('view'),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    audience: z.enum(['CLIENT_PROGRESS', 'INSTITUTION_REPORT']),
  }),
  z.object({
    action: z.literal('respond'),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    audience: z.literal('CLIENT_PROGRESS'),
    commandId: z.uuid(),
    requestId: z.uuid(),
    body: z.string().trim().min(3).max(2000),
    acknowledged: z.literal(true),
  }),
  z.object({
    action: z.literal('export'),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    audience: z.literal('INSTITUTION_REPORT'),
    commandId: z.uuid(),
    format: z.enum(['CSV', 'PDF']),
    purpose: z.string().trim().min(10).max(500),
  }),
]);
