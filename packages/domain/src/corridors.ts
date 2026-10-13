import { z } from 'zod';
import { locale, timeZone } from './geography';
import { currency } from './opportunities';
import { DomainError } from './index';
const keys = z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/)).max(50);
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
