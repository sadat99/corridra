import { z } from 'zod';
import { locale, timeZone } from './geography';
import { currency } from './opportunities';
import { DomainError } from './index';
import { offerTerms, requirementFields } from './commercial-missions';
const keys = z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/)).max(50);

// ADR-083 slice S1. The sourcing route profile is an optional block of the pack configuration, reviewed, approved and published
// with the pack by the existing flow. It is data for any route: nothing here, or anywhere that reads it, names a country.
// A pack without the block parses and behaves exactly as before. Size budget: the block is at most 4096 octets as stored text
// (the database guard enforces the same number); the whole proposal envelope stays under the existing 8192 octet limit.
export const sourcingProfileOctetBudget = 4096;
export const proposalOctetBudget = 8192;
const profileKey = z.string().regex(/^[a-z][a-z0-9_.-]{0,39}$/);
const profileKeys = (max: number) =>
  z
    .array(profileKey)
    .max(max)
    .refine((values) => new Set(values).size === values.length, 'Duplicate keys');
// Text the database can store: no NUL and no lone surrogate (jsonb refuses both), so a bad value is a validation message.
const unstorable = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const profileText = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    .refine((value) => !unstorable.test(value), 'Text the database cannot store');
const comparisonTermKey = z.enum(Object.keys(offerTerms.shape) as [string, ...string[]]);
export const sourcingCategory = z
  .object({
    key: profileKey,
    // The context prompt shown to the customer for this category. A prompt, never an instruction to buy.
    context: profileText(160),
    requiredFields: profileKeys(12),
    comparisonTerms: z
      .array(comparisonTermKey)
      .max(20)
      .refine((values) => new Set(values).size === values.length, 'Duplicate terms'),
    documentKinds: profileKeys(8),
  })
  .strict();
export const sourcingProfile = z
  .object({
    profileVersion: z.int().min(1).max(9999),
    categories: z
      .array(sourcingCategory)
      .max(8)
      .refine((v) => new Set(v.map((c) => c.key)).size === v.length, 'Duplicate categories'),
    landedCostElements: profileKeys(16),
    // A hint only, never a term and never a default on an offer.
    incotermHints: z
      .array(requirementFields.shape.incoterm.unwrap())
      .max(4)
      .refine((v) => new Set(v).size === v.length, 'Duplicate hints'),
    sampleSteps: z
      .array(z.object({ key: profileKey, label: profileText(60) }).strict())
      .max(6)
      .refine((v) => new Set(v.map((x) => x.key)).size === v.length, 'Duplicate steps'),
    visitKinds: profileKeys(8),
    supplierReplyLanguages: z
      .array(locale)
      .max(6)
      .refine((v) => new Set(v).size === v.length, 'Duplicate languages'),
    ports: z.array(profileText(40)).max(4),
    readiness: z
      .object({
        understood: profileKeys(16),
        research: profileKeys(16),
        comparableQuotes: profileKeys(16),
        readyToCommit: profileKeys(16),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (storedTextOctets(value) > sourcingProfileOctetBudget)
      ctx.addIssue({
        code: 'custom',
        message: `Sourcing profile is larger than ${sourcingProfileOctetBudget} octets`,
      });
  });
export type SourcingProfile = z.infer<typeof sourcingProfile>;

// Octets of a value as the database stores and prints it (jsonb text: a space after every colon and comma, object keys sorted
// by length then bytes), so the application and the guard measure the same number.
export function storedTextOctets(value: unknown): number {
  return new TextEncoder().encode(storedText(value)).length;
}
function storedText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(storedText).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => {
        const x = new TextEncoder().encode(a);
        const y = new TextEncoder().encode(b);
        if (x.length !== y.length) return x.length - y.length;
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
        return 0;
      })
      .map(([k, v]) => `${JSON.stringify(k)}: ${storedText(v)}`)
      .join(', ')}}`;
  return JSON.stringify(value);
}
export const routeConfiguration = z
  .object({
    missionTypes: keys,
    requiredCapabilities: keys,
    languages: z.array(locale).max(30),
    currencies: z.array(currency).max(30),
    timeZones: z.array(timeZone).max(30),
    localities: keys,
    clusters: keys,
    requirements: z.array(z.uuid()).max(50),
    assessments: z.array(z.uuid()).max(50),
    sourceCategories: keys,
    channels: z.array(z.enum(['SYNTHETIC', 'MANUAL'])),
    jurisdictionPolicyRefs: z.array(z.uuid()).max(50),
    evidenceTypes: keys,
    reviewRequired: z.literal(true),
    operatorCapabilities: keys,
    coverage: keys,
    aiPolicyRef: z.uuid().nullable(),
    pricingRef: z.uuid().nullable(),
    sourcing: sourcingProfile.optional(),
  })
  .strict();
export type RouteConfiguration = z.infer<typeof routeConfiguration>;
export const routePack = z
  .object({
    id: z.uuid(),
    routeId: z.uuid(),
    version: z.int().positive(),
    status: z.enum(['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED']),
    effectiveFrom: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(500),
    configuration: routeConfiguration,
  })
  .strict();
// Lower layers may restrict allowed sets, but cannot add authority or remove obligations.
export function resolveConfiguration(
  global: RouteConfiguration,
  ...layers: Partial<RouteConfiguration>[]
) {
  let result = routeConfiguration.parse(global);
  const allowed = [
    'missionTypes',
    'languages',
    'currencies',
    'timeZones',
    'localities',
    'clusters',
    'sourceCategories',
    'channels',
    'evidenceTypes',
    'coverage',
  ] as const;
  const required = [
    'requiredCapabilities',
    'requirements',
    'assessments',
    'operatorCapabilities',
    'jurisdictionPolicyRefs',
  ] as const;
  for (const raw of layers) {
    const layer = routeConfiguration.partial().parse(raw);
    // The profile is global only: set once on the pack root and carried through unchanged. A layer that names it, even with an
    // equal value, is an error and is never silently dropped.
    if (layer.sourcing !== undefined)
      throw new DomainError('Sourcing profile belongs to the pack root');
    for (const key of allowed) {
      const values = layer[key];
      if (values) {
        if (values.some((v) => !(result[key] as readonly string[]).includes(v)))
          throw new DomainError('Configuration cannot expand global permissions');
        result = { ...result, [key]: values };
      }
    }
    for (const key of required)
      result = { ...result, [key]: [...new Set([...result[key], ...(layer[key] ?? [])])] };
    for (const key of ['aiPolicyRef', 'pricingRef'] as const)
      if (layer[key] !== undefined && layer[key] !== result[key])
        throw new DomainError('Policy bindings require a new approved root configuration');
  }
  return routeConfiguration.parse(result);
}
export const initialRoutes = [
  {
    origin: 'BD',
    destination: 'ES',
    missions: ['export_market_access', 'buyers', 'distributors', 'meetings', 'trade_fairs'],
  },
  {
    origin: 'ES',
    destination: 'BD',
    missions: ['market_entry', 'sourcing', 'customers', 'distributors'],
  },
  {
    origin: 'BD',
    destination: 'CN',
    missions: [
      'sourcing',
      'machinery_procurement',
      'supplier_evaluation',
      'factory_visits',
      'business_trips',
      'trade_fairs',
      'delegations',
    ],
  },
  {
    origin: 'CN',
    destination: 'BD',
    missions: ['customers', 'distributors', 'partners', 'market_validation'],
  },
  {
    origin: 'BD',
    destination: 'EU',
    missions: ['export_market_access', 'buyers', 'distributors', 'trade_fairs'],
  },
  { origin: 'EU', destination: 'BD', missions: ['market_entry', 'sourcing'] },
] as const;

export function assertRouteReady(input: {
  status: z.infer<typeof routePack>['status'];
  missionType: string;
  configuration: RouteConfiguration;
  capabilities: string[];
  jurisdictionApproved: boolean;
  synthetic: boolean;
}) {
  const c = routeConfiguration.parse(input.configuration);
  if (
    !['TESTING', 'LIMITED', 'ACTIVE'].includes(input.status) ||
    !input.synthetic ||
    !input.jurisdictionApproved ||
    !c.missionTypes.includes(input.missionType) ||
    [...c.requiredCapabilities, ...c.operatorCapabilities].some(
      (k) => !input.capabilities.includes(k),
    )
  )
    throw new DomainError('Route capability or jurisdiction readiness denied');
}
