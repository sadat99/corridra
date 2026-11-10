import { countryCode } from './geography';
import { z } from 'zod';
import { realCustomerInput } from './customer-input-mode';
const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const uuid = z.uuid();
const base = { commandId: uuid };
const date = z.iso.datetime({ offset: true });
export const researchQuery = z.object({
  q: z.string().trim().max(100).default(''),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const ingestOrganisation = z.object({
  ...base,
  action: z.literal('ingest'),
  sourceId: uuid,
  name: text(160),
  country: countryCode,
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .refine(
      (value) =>
        realCustomerInput()
          ? value.length <= 253 &&
            value.includes('.') &&
            value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
          : /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*example\.invalid$/.test(value),
      'Enter a valid company domain',
    ),
  address: text(300),
  identifier: text(100).transform((v) => v.toUpperCase()),
  identifierType: z.enum(['registry', 'tax', 'source_id']),
});
export const relationshipInput = z.object({
  ...base,
  action: z.literal('relationship'),
  organisationId: uuid,
  ownerId: uuid,
  visibility: z.enum(['OWNER', 'TEAM']),
  note: text(2000, 0),
});
export const contactInput = z.object({
  ...base,
  action: z.literal('contact'),
  relationshipId: uuid,
  name: text(120),
  jobTitle: text(120),
  email: z
    .email()
    .toLowerCase()
    .refine(
      (v) => realCustomerInput() || v.endsWith('@example.invalid'),
      'Use an invented @example.invalid contact',
    ),
  sourceId: uuid,
  validUntil: date,
});
export const noteInput = z.object({
  ...base,
  action: z.literal('note'),
  relationshipId: uuid,
  body: text(2000),
  sourceId: uuid,
});
export const attributeInput = z.object({
  ...base,
  action: z.literal('attribute'),
  organisationId: uuid,
  kind: z.enum(['product', 'capability', 'certification', 'requirement', 'market']),
  claimId: uuid,
  validUntil: date,
});
export const publishInput = z.object({
  ...base,
  action: z.literal('publish'),
  attributeId: uuid,
  factId: uuid,
});
export const candidateInput = z.object({
  ...base,
  action: z.literal('candidates'),
  organisationId: uuid,
});
export const resolutionInput = z.object({
  ...base,
  action: z.literal('resolve'),
  candidateId: uuid,
  decision: z.enum(['MERGE', 'DISTINCT']),
  survivorId: uuid,
  reason: text(1000, 3),
});
export const reversalInput = z.object({
  ...base,
  action: z.literal('reverse'),
  resolutionId: uuid,
  reason: text(1000, 3),
});
export const targetInput = z.object({
  ...base,
  action: z.literal('target'),
  missionId: uuid,
  relationshipId: uuid,
  contactId: uuid.nullable(),
  rationale: text(1000, 3),
  uncertainty: text(1000, 3),
  gaps: text(1000, 3),
  nextAction: text(500, 3),
  dueAt: date,
  fit: z.enum(['RESEARCH', 'POSSIBLE', 'STRONG', 'UNSUITABLE']),
  claimIds: z.array(uuid).min(1).max(20),
});
export const assessmentInput = targetInput
  .omit({ action: true, missionId: true, relationshipId: true, contactId: true })
  .extend({ action: z.literal('assess'), targetId: uuid, version: z.number().int().positive() });
// CRUD G11 (ADR-017 amendment): withdraw, correct and hide private contacts and notes. Each names the exact version
// the person saw. Correct adds a new version through the same rules as a new record. Hide is for a workspace owner or
// admin: the ticket reference must hold no personal details (no @ and no spaces), and the record id is typed again.
const changeReason = text(500, 3);
const hideReason = text(500, 10);
const ticketReference = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/#-]{2,63}$/,
    'Use 3 to 64 letters, numbers or . _ : / # - with no spaces and no @.',
  );
const confirmId = z.string().trim().min(1).max(64);
export const withdrawContactInput = z.object({
  ...base,
  action: z.literal('withdraw_contact'),
  contactId: uuid,
  reason: changeReason,
});
export const correctContactInput = contactInput
  .omit({ action: true, relationshipId: true })
  .extend({ action: z.literal('correct_contact'), contactId: uuid, reason: changeReason });
export const withdrawNoteInput = z.object({
  ...base,
  action: z.literal('withdraw_note'),
  noteId: uuid,
  reason: changeReason,
});
export const correctNoteInput = noteInput
  .omit({ action: true, relationshipId: true })
  .extend({ action: z.literal('correct_note'), noteId: uuid, reason: changeReason });
export const redactContactInput = z.object({
  ...base,
  action: z.literal('redact_contact'),
  contactId: uuid,
  confirmId,
  reason: hideReason,
  ticketReference,
});
export const redactNoteInput = z.object({
  ...base,
  action: z.literal('redact_note'),
  noteId: uuid,
  confirmId,
  reason: hideReason,
  ticketReference,
});
export const recordChangeActions = [
  'withdraw_contact',
  'correct_contact',
  'withdraw_note',
  'correct_note',
  'redact_contact',
  'redact_note',
] as const;
export const researchCommand = z.discriminatedUnion('action', [
  ingestOrganisation,
  relationshipInput,
  contactInput,
  noteInput,
  attributeInput,
  publishInput,
  candidateInput,
  resolutionInput,
  reversalInput,
  targetInput,
  assessmentInput,
  withdrawContactInput,
  correctContactInput,
  withdrawNoteInput,
  correctNoteInput,
  redactContactInput,
  redactNoteInput,
]);
export type ResearchCommand = z.infer<typeof researchCommand>;
export type RecordChangeCommand = Extract<
  ResearchCommand,
  { action: (typeof recordChangeActions)[number] }
>;
