import { z } from 'zod';

// ADR-076 items 1 to 3: the Trip Book and the Supplier Book. A book is a projection of the reviewed saved
// report, named fields only, produced by one database function. Nothing in these shapes is optional by
// accident: an extra key, from a future function or a bug, is rejected rather than printed.
export const bookKind = z.enum(['TRIP', 'SUPPLIER']);
export type BookKind = z.infer<typeof bookKind>;

export const bookInput = z
  .object({
    resourceId: z.uuid(),
    commandId: z.uuid(),
    kind: bookKind,
    acknowledged: z.literal(true),
  })
  .strict();
export type BookInput = z.infer<typeof bookInput>;

const instant = z.iso.datetime();
const tripItem = z
  .object({
    label: z.string().min(1).max(200),
    status: z.string().min(1).max(40),
    changed: z.boolean(),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    timezone: z.string().min(1).max(100).optional(),
    location: z.string().min(1).max(500).optional(),
  })
  .strict()
  // A changed schedule carries no old time or place, even if a future function forgot to drop them.
  .refine(
    (item) =>
      !item.changed ||
      (item.startsAt === undefined &&
        item.endsAt === undefined &&
        item.timezone === undefined &&
        item.location === undefined),
    'A changed schedule carries no old details',
  );
const supplierItem = z
  .object({
    company: z.string().min(1).max(500),
    country: z.string().min(1).max(100),
    fit: z.string().min(1).max(40),
    rationale: z.string().max(1000),
    uncertainty: z.string().max(1000),
    gaps: z.string().max(1000),
    verification: z.string().min(1).max(200),
  })
  .strict();

export const bookProjection = z.discriminatedUnion('kind', [
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('TRIP'),
      title: z.string().min(1).max(200),
      company: z.string().min(1).max(200),
      objective: z.string().max(500),
      reviewedAt: instant,
      itinerary: z.array(tripItem).max(50),
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(1),
      kind: z.literal('SUPPLIER'),
      title: z.string().min(1).max(200),
      reviewedAt: instant,
      shortlist: z.array(supplierItem).max(30),
    })
    .strict(),
]);
export type BookProjection = z.infer<typeof bookProjection>;

// What the database returns for a generation: the projection plus its record. An empty book is a state,
// not an error, so nothing is written for it and the route can answer in plain words.
export const bookRecord = z
  .object({
    resourceId: z.uuid(),
    kind: bookKind,
    command: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: instant,
    expiresAt: instant,
    replayed: z.boolean(),
    projection: bookProjection,
  })
  .strict();
export type BookRecord = z.infer<typeof bookRecord>;
export const bookEmpty = z.object({ state: z.literal('EMPTY') }).strict();
export const bookResult = z.union([bookRecord, bookEmpty]);
