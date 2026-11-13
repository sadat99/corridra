import { z } from 'zod';
import { countryCode } from './geography';

// ADR-082 section 3.1: the role-agnostic structured profile of the counterparty a mission is looking for.
// One strict schema for every role (buyer, supplier, distributor, partner). The route is never a field: it comes from the
// mission's route assignment, so a profile cannot disagree with it. Nothing here is a verified fact: these are the words
// staff recorded about who to look for.
export const profileRoles = ['BUYER', 'SUPPLIER', 'DISTRIBUTOR', 'PARTNER'] as const;
export const profileCounterpartyTypes = [
  'importer',
  'distributor',
  'wholesaler',
  'retailer',
  'brand_owner',
  'manufacturer',
  'online_retailer',
  'agent',
  'institutional_buyer',
] as const;
export const profileSizeBands = ['micro', 'small', 'medium', 'large', 'any'] as const;
export const profileOrderSizeBands = ['small', 'medium', 'large', 'any'] as const;
export const profilePricePositions = ['economy', 'mid', 'premium', 'any'] as const;
export const profileMaxBytes = 8000;
export const staleProfileWords = 'This profile changed. Reload it and try again.';
export const profileWords = {
  notInstalled: 'Supply sources are not available in this workspace yet.',
  paused: 'Supply sources are paused. Records stay readable.',
  missionClosed: 'This mission is closed, so its profile cannot change.',
  missionUnavailable: 'Mission unavailable',
  stale: staleProfileWords,
  reused: 'Command ID reused with different values',
} as const;

const uuid = z.uuid();
const key = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, 'Use 2 to 40 letters, digits, hyphens or underscores');

// Profile words describe a kind of company, never a person or a way to reach one. The brief card shows some of them to
// partners, so a line that looks like an email address, a link or a phone number is refused.
export function looksLikeContact(value: string) {
  return (
    /[^\s@]+@[^\s@]+/.test(value) ||
    /(?:https?:\/\/|www\.)/i.test(value) ||
    /\b[a-z0-9-]+\.(?:com|net|org|io|co|biz|info|bd|sg|de|uk)\b/i.test(value) ||
    /(?:\+?\d[\s().-]*){7,}/.test(value)
  );
}
const words = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !looksLikeContact(value), 'Describe the company, not how to reach it');
const unique = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine(
      (list) => new Set(list.map((x) => JSON.stringify(x))).size === list.length,
      'No repeats',
    );

export const counterpartyProfileFields = z
  .object({
    productCategory: z.object({ key, words: words(3, 200) }).strict(),
    counterpartyTypes: unique(z.enum(profileCounterpartyTypes), 8).min(1),
    sizeBand: z.enum(profileSizeBands).default('any'),
    channels: unique(key, 10).default([]),
    requiredCertifications: unique(key, 10).default([]),
    orderSizeBand: z.enum(profileOrderSizeBands).default('any'),
    pricePositioning: z.enum(profilePricePositions).default('any'),
    mustHaves: unique(words(3, 160), 10).default([]),
    niceToHaves: unique(words(3, 160), 10).default([]),
    candidatesWanted: z.number().int().min(1).max(100),
    deadline: z.iso.date(),
    eventContext: z
      .object({
        month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
        country: countryCode,
        name: words(3, 120).optional(),
        nameNonIdentifying: z.boolean().default(false),
      })
      .strict()
      .optional(),
    exclusions: z
      .object({
        organisationIds: unique(uuid, 50).default([]),
        nameKeys: unique(key, 50).default([]),
      })
      .strict()
      .default({ organisationIds: [], nameKeys: [] }),
    sellerNotes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((fields) => new TextEncoder().encode(JSON.stringify(fields)).length <= profileMaxBytes, {
    message: 'The profile is too long',
  });
export type CounterpartyProfileFields = z.infer<typeof counterpartyProfileFields>;

export const saveCounterpartyProfile = z
  .object({
    commandId: uuid,
    missionId: uuid,
    role: z.enum(profileRoles),
    // The version the person was looking at: 0 for a first profile. A different number means it changed since.
    expectedVersion: z.number().int().min(0).max(100000),
    fields: counterpartyProfileFields,
    reason: z.string().trim().min(3).max(500),
    // The free-text version the profile was written beside, if any.
    targetProfileId: uuid.optional(),
  })
  .strict();
export type SaveCounterpartyProfile = z.infer<typeof saveCounterpartyProfile>;

export const readCounterpartyProfile = z
  .object({ missionId: uuid, role: z.enum(profileRoles) })
  .strict();

/** JSON with every object key in sorted order, so equal requests hash equally whatever order the keys arrived in. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((name) => (value as Record<string, unknown>)[name] !== undefined)
      .map(
        (name) =>
          `${JSON.stringify(name)}:${canonicalJson((value as Record<string, unknown>)[name])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}

/**
 * The brief card view: only what the table in ADR-082 section 3.1 marks for the card. Must-haves and nice-to-haves appear
 * only when staff approved the exact line, the event name only when staff marked it non-identifying, and exclusions and
 * seller notes never.
 */
export function briefCardFields(
  fields: CounterpartyProfileFields,
  approvedLines: readonly string[] = [],
) {
  const approved = new Set(approvedLines);
  const card = {
    productCategory: fields.productCategory,
    counterpartyTypes: fields.counterpartyTypes,
    sizeBand: fields.sizeBand,
    channels: fields.channels,
    requiredCertifications: fields.requiredCertifications,
    orderSizeBand: fields.orderSizeBand,
    pricePositioning: fields.pricePositioning,
    mustHaves: fields.mustHaves.filter((line) => approved.has(line)),
    niceToHaves: fields.niceToHaves.filter((line) => approved.has(line)),
    candidatesWanted: fields.candidatesWanted,
    deadline: fields.deadline,
    ...(fields.eventContext
      ? {
          eventContext: {
            month: fields.eventContext.month,
            country: fields.eventContext.country,
            ...(fields.eventContext.name && fields.eventContext.nameNonIdentifying
              ? { name: fields.eventContext.name }
              : {}),
          },
        }
      : {}),
  };
  return card;
}
