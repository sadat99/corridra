import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RequestContext } from '@corridra/db';
import { currency } from '@corridra/domain/opportunities';
import { locale, timeZone } from '@corridra/domain/geography';
import type { RouteConfiguration } from '@corridra/domain/corridors';
import type { CorridorService } from './corridors';

// createRoutePack (commercial readiness program, 5.2, CQ-66). Takes guided form input and builds the
// existing reviewed route pack command on the server. The person never types JSON. Review stays
// required and channels stay limited to the existing values. Owner after Wave 0: WS-D (it lives in the
// missions package next to CorridorService so the command stays in one place).
export const guidedRoutePack = z
  .object({
    routeId: z.uuid(),
    version: z.int().positive(),
    status: z.enum(['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED']),
    effectiveFrom: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(3).max(500),
    missionTypes: z
      .array(z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/))
      .min(1)
      .max(50),
    languages: z.array(locale).max(30).default([]),
    currencies: z.array(currency).max(30).default([]),
    timeZones: z.array(timeZone).max(30).default([]),
    manualChannel: z.boolean().default(false),
  })
  .strict();
export type GuidedRoutePack = z.input<typeof guidedRoutePack>;

export function routePackConfiguration(v: z.infer<typeof guidedRoutePack>): RouteConfiguration {
  return {
    missionTypes: v.missionTypes,
    requiredCapabilities: [],
    languages: v.languages,
    currencies: v.currencies,
    timeZones: v.timeZones,
    localities: [],
    clusters: [],
    requirements: [],
    assessments: [],
    sourceCategories: [],
    channels: v.manualChannel ? ['MANUAL'] : ['SYNTHETIC'],
    jurisdictionPolicyRefs: [],
    evidenceTypes: [],
    reviewRequired: true,
    operatorCapabilities: [],
    coverage: [],
    aiPolicyRef: null,
    pricingRef: null,
  };
}

export function createRoutePack(corridors: CorridorService, ctx: RequestContext, input: unknown) {
  const v = guidedRoutePack.parse(input);
  return corridors.appendPack(ctx, {
    id: randomUUID(),
    routeId: v.routeId,
    version: v.version,
    status: v.status,
    effectiveFrom: v.effectiveFrom,
    reason: v.reason,
    configuration: routePackConfiguration(v),
  });
}
