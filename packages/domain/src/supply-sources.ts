import { z } from 'zod';
import { countryCode } from './geography';
import {
  profileCounterpartyTypes,
  profileSizeBands,
  profileWords,
  staleProfileWords,
} from './counterparty-profiles';

// ADR-082 sections 3.2, 3.3, 3.6, 5 and 6 (slice S3): the source registry, the candidate and its company-level facts, the
// do-not-contact record and the file the staff upload. Nothing here is a verified fact: a candidate is what one source
// reported about a company, and it reads "source-reported" wherever it is shown. No column of this module holds a person's
// name, email or phone number, so every free text is checked for those shapes, here and again in SQL.
export const supplySourceKinds = [
  'staff_research',
  'partner_organisation',
  'partner_person',
  'data_platform',
] as const;
export type SupplySourceKind = (typeof supplySourceKinds)[number];
export const supplySourceStatuses = [
  'no_agreement',
  'active',
  'paused',
  'expired',
  'retired',
] as const;
export const supplyMethods = ['manual', 'file_import', 'partner_submission', 'connector'] as const;
export const supplyReviewDecisions = [
  'QUALIFIED',
  'WRONG_FIT',
  'DUPLICATE',
  'EXPIRED',
  'REJECTED_SOURCE',
] as const;
export const supplyMatchDecisions = ['MATCH', 'NO_MATCH', 'REVERSE'] as const;
export const supplyMaxRows = 100;
// The eight columns of a candidate file. `nomination_note` is accepted from manual staff entry only.
export const supplyFileColumns = [
  'company_name',
  'country',
  'website_host',
  'public_identifier',
  'size_band',
  'counterparty_types',
  'observed_at',
  'source_locator',
] as const;
// Row reason codes the import function reports. The row text is never stored beside them.
export const supplyRowCodes = [
  'ok',
  'bad_country',
  'bad_size',
  'bad_types',
  'bad_date',
  'too_long',
  'contact_details',
  'dnc_blocked',
  'duplicate_key',
  'source_inactive',
] as const;

// The exact sentences the SQL commands raise and the screens show. A refusal is answered as a conflict, never a server error.
export const supplyWords = {
  notInstalled: profileWords.notInstalled,
  paused: profileWords.paused,
  reused: profileWords.reused,
  missionUnavailable: profileWords.missionUnavailable,
  missionClosed: 'This mission is closed, so its candidates cannot change.',
  profileUnavailable: 'Profile version unavailable',
  sourceUnavailable: 'Source unavailable',
  candidateUnavailable: 'Candidate unavailable',
  organisationUnavailable: 'Organisation unavailable',
  stale: staleProfileWords,
  staleSource: 'This source changed. Reload it and try again.',
  notActive: 'This source is not active. Check its status and agreement.',
  needsAgreement:
    'This kind of source needs an agreement record with current reuse rights before it can be active.',
  contactDetails: 'Remove contact details; personal data cannot be recorded here.',
  blocked: 'This company asked not to be contacted.',
  notBlocked: 'This company is not blocked.',
  retentionPassed: 'The retention date for this record has passed.',
  expired: 'This candidate has expired and can no longer be decided.',
  fileClosed: 'File import is not available yet.',
  tooManyRows: `Use at most ${supplyMaxRows} candidate rows`,
  personalColumns:
    'This file has personal contact columns. Remove them; personal data cannot be imported.',
  unknownColumns: (headers: readonly string[]) =>
    `This file has columns Corridra does not accept: ${headers.join(', ')}. Use only the eight listed columns.`,
  noColumns: 'The file has no header row. Use only the eight listed columns.',
  exactColumns: `Use exactly the eight listed columns, each once: ${supplyFileColumns.join(', ')}.`,
  extraValues: (row: number) => `Row ${row} has more values than columns.`,
  noRows: 'Include at least one candidate row',
  reverseFirst: 'Reverse the current match first.',
  reverseLatest: 'Reverse the latest match of this candidate.',
  licensed:
    'This company was recorded from a licensed or unclassified source. Record it from a public source first.',
  independentReview: 'The reviewer must be someone other than the person who submitted it.',
  sourceReported: 'source-reported',
} as const;

const uuid = z.uuid();
const reason = z.string().trim().min(3).max(500);
const key = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use 2 to 40 lowercase letters, digits or underscores');

/** The same two shapes as the SQL checks: an email shape, and a run of 7 or more digits with spaces, dots, dashes or brackets. */
const emailShape = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const phoneShape = /\+?\d(?:[\s.()-]*\d){6,}/;
export function hasContactShape(text: string, options: { phone: boolean } = { phone: true }) {
  return emailShape.test(text) || (options.phone && phoneShape.test(text));
}
const free = (min: number, max: number, phone = true) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !hasContactShape(value, { phone }), supplyWords.contactDetails);

const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9.-]{0,118}[a-z0-9])?$/, 'Use a website host such as example.com');
const sizeBands = profileSizeBands.filter((band) => band !== 'any');
const counterpartyTypes = z
  .array(z.enum(profileCounterpartyTypes))
  .max(8)
  .refine((list) => new Set(list).size === list.length, 'No repeats');
const observedAt = z.iso.datetime({ offset: true });
const months = z.number().int().min(1).max(24);

const sourceFields = {
  label: z.string().trim().min(3).max(120),
  sourceRecordId: uuid.optional(),
  defaultRetentionMonths: months,
  agreementEndsAt: observedAt.optional(),
  reason,
};
export const createSource = z
  .object({
    commandId: uuid,
    kind: z.enum(supplySourceKinds),
    status: z.enum(['no_agreement', 'active']),
    ...sourceFields,
  })
  .strict();
export const addSourceVersion = z
  .object({
    commandId: uuid,
    sourceId: uuid,
    // The version the person was looking at. A different number means it changed since.
    expectedVersion: z.number().int().min(1).max(100000),
    status: z.enum(supplySourceStatuses),
    ...sourceFields,
  })
  .strict();

const candidateFacts = {
  companyName: free(1, 160),
  country: countryCode,
  websiteHost: host.optional(),
  publicIdentifier: free(1, 80, false).optional(),
  sizeBand: z.enum(sizeBands as [string, ...string[]]).optional(),
  counterpartyTypes: counterpartyTypes.default([]),
  observedAt,
  sourceLocator: free(1, 500),
};
export const addCandidate = z
  .object({
    commandId: uuid,
    missionId: uuid,
    profileVersionId: uuid,
    sourceVersionId: uuid,
    nominationNote: free(3, 500).optional(),
    ...candidateFacts,
  })
  .strict();

export const importMeta = z
  .object({
    commandId: uuid,
    missionId: uuid,
    profileVersionId: uuid,
    sourceVersionId: uuid,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    rows: z
      .array(
        z
          .object({
            row: z
              .number()
              .int()
              .min(2)
              .max(supplyMaxRows + 1),
            cells: z.record(z.enum(supplyFileColumns), z.string().max(1000)),
          })
          .strict(),
      )
      .min(1)
      .max(supplyMaxRows),
  })
  .strict();

export const reviewCandidate = z
  .object({
    commandId: uuid,
    candidateId: uuid,
    decision: z.enum(supplyReviewDecisions),
    reasonCode: key,
    reason,
  })
  .strict();
export const matchCandidate = z
  .object({
    commandId: uuid,
    candidateId: uuid,
    decision: z.enum(supplyMatchDecisions),
    organisationId: uuid.optional(),
    reverseOf: uuid.optional(),
    reason,
  })
  .strict()
  .refine(
    (v) => (v.decision === 'REVERSE') === (v.reverseOf !== undefined),
    'A reverse names the match it reverses, and nothing else does',
  )
  .refine(
    (v) =>
      v.decision === 'REVERSE' ? v.organisationId === undefined : v.organisationId !== undefined,
    'A match or a no match names the organisation; a reverse names none',
  );

const dncSubject = {
  organisationId: uuid.optional(),
  companyName: free(1, 160).optional(),
  country: countryCode.optional(),
  reason,
  // A ticket or note number, never a person: no email shape and no run of 7 digits.
  reference: free(3, 120),
};
const oneSubject = (v: { organisationId?: string; companyName?: string; country?: string }) =>
  v.organisationId !== undefined
    ? v.companyName === undefined && v.country === undefined
    : v.companyName !== undefined && v.country !== undefined;
export const blockCompany = z
  .object({ commandId: uuid, ...dncSubject })
  .strict()
  .refine(oneSubject, 'Name an organisation, or a company name and a country');
export const liftCompany = blockCompany;

export type SupplySourceInput = z.infer<typeof createSource>;
export type AddCandidateInput = z.infer<typeof addCandidate>;

// ---- file headers ----------------------------------------------------------------------------------------------------

/** A header that looks personal: a name, email, phone, contact or person column, or one containing those words. */
const personalHeader = /name|e-?mail|phone|mobile|contact|person/i;
/**
 * Classifies the headers of a candidate file against the eight accepted columns. `personal` headers refuse the file with the
 * personal-columns sentence, any other unknown header with the unknown-columns sentence. `company_name` is accepted, so the
 * word "name" only counts when the header is not one of the eight.
 */
export function classifySupplyHeaders(headers: readonly string[]) {
  const accepted = new Set<string>(supplyFileColumns);
  const personal: string[] = [];
  const unknown: string[] = [];
  for (const header of headers) {
    if (accepted.has(header)) continue;
    (personalHeader.test(header) ? personal : unknown).push(header);
  }
  return { personal, unknown };
}

// ---- route binding ---------------------------------------------------------------------------------------------------

const routeCategory: Record<Exclude<SupplySourceKind, 'staff_research'>, string> = {
  partner_organisation: 'supply.partner_organisation',
  partner_person: 'supply.partner_person',
  data_platform: 'supply.data_platform',
};
const offeringStatuses = new Set(['TESTING', 'LIMITED', 'ACTIVE']);
/**
 * The source kinds a mission's route offers (ADR-082 section 5). `staff_research` is allowed on every route. Another kind is
 * offered only when the mission's current route assignment points at a pack version that is TESTING, LIMITED or ACTIVE and
 * whose `configuration.sourceCategories` lists the kind's key. A DRAFT or PAUSED pack, a legacy unresolved assignment or no
 * pack at all offers staff research only. Configuration only: there is no country code here.
 */
export function supplyKindsOnRoute(
  pack: { status: string; configuration: { sourceCategories?: readonly string[] } } | null,
): SupplySourceKind[] {
  const kinds: SupplySourceKind[] = ['staff_research'];
  if (!pack || !offeringStatuses.has(pack.status)) return kinds;
  const categories = new Set(pack.configuration.sourceCategories ?? []);
  for (const kind of Object.keys(routeCategory) as (keyof typeof routeCategory)[])
    if (categories.has(routeCategory[kind])) kinds.push(kind);
  return kinds;
}
