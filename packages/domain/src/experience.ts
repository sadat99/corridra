import { z } from 'zod';
import { countryCode, timeZone } from './geography';
import { missionCatalogue, requirementFields, offerTerms } from './commercial-missions';
import { currency } from './opportunities';

export const missionJob = z.enum(missionCatalogue.map((v) => v.key));
export const intakeExperience = z
  .object({
    schemaVersion: z.literal(1),
    companyCountry: countryCode,
    marketCode: z.union([countryCode, z.literal('EU')]),
    job: missionJob,
    requirements: requirementFields,
    organiser: z.string().trim().min(3).max(160).optional(),
    participants: z.string().trim().min(3).max(1000).optional(),
  })
  .strict();
const text = z.string().trim().min(3).max(1000);
export const delegationContextInput = z
  .object({
    commandId: z.uuid(),
    programmeId: z.uuid(),
    version: z.int().positive(),
    organiser: text,
    marketCode: z.union([countryCode, z.literal('EU')]),
    purpose: text,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    timezone: timeZone,
    ownerId: z.uuid(),
    reason: text,
  })
  .strict()
  .refine(
    (v) => new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime(),
    'End must follow start',
  );
export const agendaInput = z
  .object({
    commandId: z.uuid(),
    programmeId: z.uuid(),
    itemId: z.uuid(),
    version: z.int().positive(),
    label: text,
    missionIds: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((v) => new Set(v).size === v.length),
    meetingIds: z
      .array(z.uuid())
      .max(100)
      .refine((v) => new Set(v).size === v.length),
    state: z.enum(['PROPOSED', 'CONFIRMED', 'CANCELLED']),
    ownerId: z.uuid(),
    nextAction: text,
    dueAt: z.iso.datetime({ offset: true }),
    reason: text,
  })
  .strict()
  .refine(
    (v) => v.state !== 'CONFIRMED' || v.meetingIds.length > 0,
    'Confirmed agenda needs actual scheduled meetings',
  );
export const missionExperienceInput = z
  .object({
    commandId: z.uuid(),
    publicationId: z.uuid(),
    requirementId: z.uuid().nullable(),
    targetIds: z
      .array(z.uuid())
      .max(30)
      .refine((v) => new Set(v).size === v.length),
    quotationIds: z
      .array(z.uuid())
      .max(30)
      .refine((v) => new Set(v).size === v.length),
    agendaItemIds: z.array(z.uuid()).max(100),
    approved: z.literal(true),
    reason: text,
  })
  .strict();
export const recipientDisclosureInput = z
  .object({
    commandId: z.uuid(),
    linkId: z.uuid(),
    role: z.enum(['BUYER', 'SUPPLIER', 'DISTRIBUTOR', 'PARTNER']),
    sharedRequirements: text,
    uncertainty: text,
    rfqId: z.uuid().nullable(),
    allowQuotation: z.boolean(),
    allowMeetingInterest: z.boolean(),
    approved: z.literal(true),
    reason: text,
  })
  .strict()
  .refine(
    (v) => !v.allowQuotation || (v.role === 'SUPPLIER' && !!v.rfqId),
    'Supplier quotation needs a matching RFQ',
  );
export const recipientReply = z
  .object({
    action: z.literal('detail-response'),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    responseId: z.uuid(),
    body: text,
    meetingInterest: z.boolean(),
    quotation: z.object({ currency, terms: offerTerms, uncertainties: text }).strict().nullable(),
    acknowledged: z.literal(true),
  })
  .strict();

export const participantIdentityInput = z
  .object({
    commandId: z.uuid(),
    participantId: z.uuid(),
    organisationId: z.uuid(),
    sourceId: z.uuid(),
    claimId: z.uuid(),
    reason: z.string().trim().min(3).max(1000),
    approved: z.literal(true),
  })
  .strict();
