import { z } from 'zod';
import { currency } from './opportunities';
import { timeZone } from './geography';
import { DomainError } from './index';

const text = z.string().trim().min(3).max(1000);
const list = z.array(text).max(30);
const amount = z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const quantity = z.string().regex(/^[1-9][0-9]{0,11}$/);
const timestamp = z.iso.datetime({ offset: true });
export const missionCatalogue = [
  { key: 'buyers', label: 'Find buyers', criteria: ['commercial_relevance', 'buyer_fit'] },
  { key: 'customers', label: 'Find customers', criteria: ['commercial_relevance', 'buyer_fit'] },
  { key: 'distributors', label: 'Find distributors', criteria: ['distributor_capability'] },
  { key: 'partners', label: 'Find commercial partners', criteria: ['commercial_relevance'] },
  { key: 'sourcing', label: 'Source products or components', criteria: ['supplier_fit'] },
  {
    key: 'machinery_procurement',
    label: 'Procure machinery',
    criteria: ['machinery_fit', 'supplier_fit'],
  },
  { key: 'supplier_evaluation', label: 'Qualify suppliers', criteria: ['supplier_fit'] },
  { key: 'meetings', label: 'Arrange commercial meetings', criteria: ['commercial_relevance'] },
  { key: 'factory_visits', label: 'Conduct site visits', criteria: ['visit_suitability'] },
  { key: 'trade_fairs', label: 'Improve trade-fair yield', criteria: ['commercial_relevance'] },
  {
    key: 'business_trips',
    label: 'Plan commercial trip execution',
    criteria: ['commercial_relevance'],
  },
  { key: 'market_validation', label: 'Validate a market', criteria: ['commercial_relevance'] },
  {
    key: 'market_entry',
    label: 'Enter a market',
    criteria: ['buyer_fit', 'distributor_capability'],
  },
  { key: 'export_market_access', label: 'Develop export access', criteria: ['buyer_fit'] },
  { key: 'delegations', label: 'Run a multi-company mission', criteria: ['commercial_relevance'] },
] as const;
export const criterion = z.enum([
  'commercial_relevance',
  'buyer_fit',
  'supplier_fit',
  'distributor_capability',
  'machinery_fit',
  'visit_suitability',
  'evidence_completeness',
]);
export const machineryFields = [
  'application',
  'capacity',
  'configuration',
  'inputOutput',
  'utilities',
  'integration',
  'documentation',
  'commissioning',
  'training',
  'acceptance',
  'warrantySpares',
  'support',
  'installationReferences',
  'transport',
  'risks',
] as const;
export const requirementFields = z
  .object({
    objective: text,
    role: z.enum(['EXPORTER', 'IMPORTER', 'BUYER', 'SUPPLIER', 'INSTITUTION', 'OPERATOR']),
    product: text,
    category: text.optional(),
    specifications: text.optional(),
    quantity: quantity.optional(),
    unit: text.optional(),
    targetMarkets: z.array(z.string().min(2).max(80)).max(30).optional(),
    budgetMinor: amount.optional(),
    currency: currency.optional(),
    budgetBasis: text.optional(),
    moq: quantity.optional(),
    orderFrequency: text.optional(),
    materials: text.optional(),
    dimensions: text.optional(),
    technicalConstraints: text.optional(),
    certifications: list.optional(),
    oemOdm: text.optional(),
    delivery: text.optional(),
    leadTime: text.optional(),
    incoterm: z
      .enum(['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'])
      .optional(),
    requiredEvidence: list.optional(),
    travelDates: text.optional(),
    decisionCriteria: list.optional(),
    responsiblePersons: list.optional(),
    machinery: z
      .object(
        Object.fromEntries(machineryFields.map((k) => [k, text.optional()])) as Record<
          (typeof machineryFields)[number],
          z.ZodOptional<typeof text>
        >,
      )
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.budgetMinor !== undefined || v.currency !== undefined || v.budgetBasis !== undefined) &&
      !(v.budgetMinor !== undefined && v.currency && v.budgetBasis)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Budget needs amount, original currency and quantity basis',
      });
    if ((v.quantity || v.moq) && !v.unit)
      ctx.addIssue({ code: 'custom', message: 'Quantity needs a unit' });
  });
export const offerTerms = z
  .object({
    specification: text.optional(),
    quantity: quantity.optional(),
    moq: quantity.optional(),
    unit: text.optional(),
    unitPriceMinor: amount.optional(),
    totalPriceMinor: amount.optional(),
    toolingMinor: amount.optional(),
    setupMinor: amount.optional(),
    packagingMinor: amount.optional(),
    leadTime: text.optional(),
    validUntil: timestamp.optional(),
    incoterm: requirementFields.shape.incoterm,
    shipping: z.enum(['INCLUDED', 'EXCLUDED', 'NOT_SUPPLIED']).optional(),
    warranty: text.optional(),
    installation: text.optional(),
    training: text.optional(),
    spares: text.optional(),
    paymentTerms: text.optional(),
  })
  .strict();
export type OfferTerms = z.infer<typeof offerTerms>;
const base = { commandId: z.uuid(), missionId: z.uuid(), reason: text };
const provenance = { sourceId: z.uuid(), claimId: z.uuid() };
export const commercialMissionCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...base,
      ...provenance,
      action: z.literal('requirements'),
      assignmentId: z.uuid(),
      definitionId: z.uuid(),
      version: z.int().positive(),
      schemaVersion: z.literal(1),
      declaration: z.string().min(3).max(2000),
      fields: requirementFields,
      reviewerId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      ...provenance,
      action: z.literal('assessment'),
      requirementId: z.uuid(),
      definitionId: z.uuid(),
      targetId: z.uuid(),
      version: z.int().positive(),
      method: text,
      observedAt: timestamp,
      results: z
        .array(
          z
            .object({
              criterion,
              result: z.enum(['FIT', 'GAP', 'UNKNOWN', 'UNSUITABLE']),
              requirement: text,
              basis: text,
            })
            .strict(),
        )
        .min(1)
        .max(30),
      technicalResults: z
        .array(
          z
            .object({
              field: z.enum(machineryFields),
              result: z.enum(['FIT', 'GAP', 'UNKNOWN', 'UNSUITABLE']),
              basis: text,
            })
            .strict(),
        )
        .max(15)
        .optional(),
      unknowns: text,
      gaps: text,
      rationale: text,
    })
    .strict(),
  z
    .object({
      ...base,
      ...provenance,
      action: z.literal('rfq'),
      requirementId: z.uuid(),
      targetIds: z
        .array(z.uuid())
        .min(1)
        .max(30)
        .refine((v) => new Set(v).size === v.length),
      buyerContext: text,
      requestedTerms: text,
      dueAt: timestamp,
    })
    .strict(),
  z
    .object({
      ...base,
      ...provenance,
      action: z.literal('quotation'),
      rfqId: z.uuid(),
      targetId: z.uuid(),
      revision: z.int().positive(),
      previousId: z.uuid().optional(),
      currency,
      terms: offerTerms,
      uncertainties: text,
      observedAt: timestamp,
    })
    .strict(),
  z
    .object({
      ...base,
      ...provenance,
      action: z.literal('decision'),
      requirementId: z.uuid(),
      targetId: z.uuid(),
      assessmentId: z.uuid(),
      quotationId: z.uuid().optional(),
      decision: z.enum(['SELECT', 'DECLINE', 'NEED_INFORMATION']),
      rationale: text,
      nextAction: text,
      ownerId: z.uuid(),
      dueAt: timestamp,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal('schedule'),
      version: z.int().positive(),
      entries: z
        .array(
          z
            .object({
              kind: z.enum([
                'DESTINATION',
                'EVENT',
                'CANDIDATE',
                'APPOINTMENT',
                'AVAILABILITY',
                'CONSTRAINT',
                'LOGISTICS',
              ]),
              label: text,
              location: text.optional(),
              timezone: timeZone,
              startsAt: timestamp.optional(),
              endsAt: timestamp.optional(),
              meetingId: z.uuid().optional(),
              sourceId: z.uuid().optional(),
              note: text,
            })
            .strict()
            .superRefine((v, ctx) => {
              if (v.kind === 'APPOINTMENT' && !v.meetingId)
                ctx.addIssue({
                  code: 'custom',
                  message: 'Appointments reference a confirmed meeting',
                });
              if (
                Boolean(v.startsAt) !== Boolean(v.endsAt) ||
                (v.startsAt && v.endsAt && v.endsAt <= v.startsAt)
              )
                ctx.addIssue({ code: 'custom', message: 'Provide an ordered time window' });
            }),
        )
        .max(50),
    })
    .strict(),
]);
export function compareOffers(
  offers: {
    id: string;
    currency: string;
    terms: OfferTerms;
    requirementId: string;
    uncertainties: string;
    evidenceCurrent?: boolean;
  }[],
  calculatedAt = new Date().toISOString(),
) {
  const reference = offers[0];
  return offers.map((offer) => {
    const terms = offerTerms.parse(offer.terms);
    const missing = [
      'specification',
      'quantity',
      'unit',
      'unitPriceMinor',
      'leadTime',
      'validUntil',
      'incoterm',
      'shipping',
      'paymentTerms',
      'toolingMinor',
      'setupMinor',
      'packagingMinor',
    ].filter(
      (k) =>
        terms[k as keyof OfferTerms] === undefined ||
        terms[k as keyof OfferTerms] === 'NOT_SUPPLIED',
    );
    const expired = terms.validUntil !== undefined && terms.validUntil <= calculatedAt;
    const inconsistentTotal =
      terms.unitPriceMinor !== undefined &&
      terms.quantity !== undefined &&
      terms.totalPriceMinor !== undefined &&
      BigInt(terms.totalPriceMinor) !== BigInt(terms.unitPriceMinor) * BigInt(terms.quantity);
    const different =
      reference &&
      (offer.requirementId !== reference.requirementId ||
        offer.currency !== reference.currency ||
        ['specification', 'quantity', 'unit', 'incoterm', 'shipping'].some(
          (k) => terms[k as keyof OfferTerms] !== reference.terms[k as keyof OfferTerms],
        ));
    return {
      ...offer,
      missing,
      status:
        missing.length ||
        expired ||
        different ||
        inconsistentTotal ||
        offer.evidenceCurrent === false
          ? 'NOT COMPARABLE'
          : 'COMPARABLE ON SUPPLIED TERMS',
      inconsistentTotal,
      expired,
      derivedTotal:
        terms.unitPriceMinor !== undefined && terms.quantity
          ? {
              amountMinor: (BigInt(terms.unitPriceMinor) * BigInt(terms.quantity)).toString(),
              currency: offer.currency,
              inputs: { unitPriceMinor: terms.unitPriceMinor, quantity: terms.quantity },
              calculatedAt,
              scope: 'Unit price times quantity only; other costs remain separate',
            }
          : null,
    };
  });
}
export function assertAssessmentTemplate(typeKey: string, criteria: string[]) {
  const template = missionCatalogue.find((t) => t.key === typeKey);
  if (
    !template ||
    [...template.criteria, 'evidence_completeness'].some((k) => !criteria.includes(k))
  )
    throw new DomainError('Complete the configured assessment criteria', 400);
}
