import { z } from 'zod';
import { requirementFields } from './commercial-missions';

const pinnedRequirement = {
  requirementId: z.uuid(),
  requirementVersion: z.number().int().positive(),
  requirementDigest: z.string().regex(/^[a-f0-9]{64}$/),
};
export const specificationRequestInput = z
  .object({
    commandId: z.uuid(),
    publicationId: z.uuid(),
    ...pinnedRequirement,
    ownerId: z.uuid(),
    dueAt: z.iso.datetime({ offset: true }),
    approved: z.literal(true),
  })
  .strict();
export const specificationConfirmationInput = z
  .object({
    resourceId: z.uuid(),
    commandId: z.uuid(),
    requestId: z.uuid(),
    ...pinnedRequirement,
    acknowledged: z.literal(true),
  })
  .strict();
export const specificationConfirmationReceipt = z
  .object({
    id: z.uuid(),
    confirmed: z.literal(true),
    replayed: z.boolean(),
  })
  .strict();
export const specificationReview = z
  .object({
    requestId: z.uuid(),
    ...pinnedRequirement,
    state: z.enum(['OPEN', 'CONFIRMED', 'RESPONDED', 'CANCELLED', 'REVIEW_REQUIRED']),
    declaration: z.string().max(2000).nullable(),
    fields: requirementFields.nullable(),
    confirmedAt: z.iso.datetime({ offset: true }).nullable(),
    dueAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const specificationReviewList = z
  .object({
    resourceId: z.uuid(),
    reviews: z.array(specificationReview).max(30),
    expiresAt: z.iso.datetime({ offset: true }),
    synthetic: z.boolean(),
  })
  .strict();
export const specificationOptions = z
  .object({
    publicationId: z.uuid(),
    requirement: z
      .object({
        ...pinnedRequirement,
        declaration: z.string().max(2000),
        fields: requirementFields,
      })
      .strict()
      .nullable(),
    requests: z
      .array(
        z
          .object({
            requestId: z.uuid(),
            requirementVersion: z.number().int().positive(),
            confirmedAt: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
