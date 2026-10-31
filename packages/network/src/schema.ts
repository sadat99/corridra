import { z } from 'zod';
const text = z.string().trim().min(3).max(500);
const key = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/);
const country = z.string().regex(/^[A-Z]{2}$/);
export const categories = z.enum([
  'local_operator',
  'sourcing_expert',
  'connector',
  'interpreter',
  'technical_adviser',
  'factory_coordinator',
  'field_researcher',
  'verification_professional',
  'institution_operator',
  'private_connector',
]);
export const taskKinds = z.enum([
  'supplier_research',
  'introductions',
  'factory_coordination',
  'price_checks',
  'interpreting',
  'translation',
  'samples',
  'followup',
  'site_support',
  'category_intelligence',
  'delegation_assistance',
]);
export const profileInput = z
  .object({
    id: z.uuid().toLowerCase(),
    principalId: z.uuid().toLowerCase(),
    version: z.number().int().positive(),
    alias: text,
    categories: z.array(categories).min(1).max(10),
    capabilities: z.array(key).min(1).max(30),
    markets: z.array(country).min(1).max(30),
    languages: z
      .array(z.string().regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/))
      .min(1)
      .max(20),
    sectors: z.array(key).min(1).max(20),
    workCountries: z.array(country).min(1).max(30),
    available: z.boolean(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'RETIRED']),
    eligibilitySourceId: z.uuid().toLowerCase(),
    expiresAt: z.iso.datetime({ offset: true }),
    reason: text,
  })
  .strict();
export const taskInput = z
  .object({
    id: z.uuid().toLowerCase(),
    missionId: z.uuid().toLowerCase(),
    // Optional: when absent the server uses the mission's current route assignment (CQ-64).
    routeAssignmentId: z.uuid().toLowerCase().optional(),
    kind: taskKinds,
    market: country,
    workCountry: country,
    location: text,
    language: z.string().regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/),
    sector: key,
    capabilities: z.array(key).min(1).max(30),
    instructions: z.string().trim().min(10).max(2000),
    deadline: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    evidenceRequired: text,
    effort: text,
    dataHandling: text,
    cancellationTerms: text,
    disputeTerms: text,
    reviewerId: z.uuid().toLowerCase(),
    rewardRuleId: z.uuid().toLowerCase().nullable(),
    reason: text,
  })
  .strict()
  .refine((v) => Date.parse(v.expiresAt) > Date.parse(v.deadline), 'Expiry must follow deadline');
export const eventInput = z
  .object({
    commandId: z.uuid().toLowerCase(),
    taskId: z.uuid().toLowerCase(),
    version: z.number().int().nonnegative(),
    action: z.enum([
      'ASSIGN',
      'ACCEPT',
      'SUBMIT',
      'REQUEST_CORRECTION',
      'REVIEW',
      'COMPLETE',
      'REJECT',
      'DISPUTE',
      'RESOLVE',
      'CANCEL',
    ]),
    reason: text,
    details: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('assignment'),
          profileId: z.uuid().toLowerCase(),
          relationshipDisclosure: text,
        })
        .strict(),
      z
        .object({ kind: z.literal('submission'), body: z.string().trim().min(3).max(2000) })
        .strict(),
      z
        .object({
          kind: z.literal('review'),
          sourceId: z.uuid().toLowerCase(),
          claimId: z.uuid().toLowerCase(),
          evidenceQuality: z.number().int().min(0).max(4),
          timeliness: z.number().int().min(0).max(4),
          rationale: text,
          verificationId: z.uuid().toLowerCase().nullable(),
        })
        .strict(),
      z
        .object({
          kind: z.literal('decision'),
          resolution: z.enum(['UPHOLD', 'REJECT', 'REOPEN']).optional(),
        })
        .strict(),
    ]),
  })
  .strict()
  .superRefine((v, c) => {
    const kind =
      v.action === 'ASSIGN'
        ? 'assignment'
        : v.action === 'SUBMIT'
          ? 'submission'
          : v.action === 'REVIEW'
            ? 'review'
            : 'decision';
    if (v.action === 'RESOLVE' && (v.details.kind !== 'decision' || !v.details.resolution))
      c.addIssue({ code: 'custom', message: 'Explicit dispute disposition required' });
    if (v.action !== 'RESOLVE' && v.details.kind === 'decision' && v.details.resolution)
      c.addIssue({ code: 'custom', message: 'Disposition belongs to dispute resolution' });
    if (v.details.kind !== kind) c.addIssue({ code: 'custom', message: 'Action details mismatch' });
  });
