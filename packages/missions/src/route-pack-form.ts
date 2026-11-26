import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { RequestContext } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import { currency } from '@corridra/domain/opportunities';
import { locale, timeZone } from '@corridra/domain/geography';
import { sourcingProfile, type RouteConfiguration } from '@corridra/domain/corridors';
import {
  carriedConfiguration,
  goLiveMessage,
  type PackStatus,
  type SheetLockedKey,
} from '@corridra/domain/route-pack-standard';
import type { CorridorService } from './corridors';
import type { OperationsService } from './operations';
import { commandStepId, type RoutePackContentService } from './route-pack-content';

// createRoutePack (commercial readiness program, 5.2, CQ-66). Takes guided form input and builds the
// existing reviewed route pack command on the server. The person never types JSON. Review stays
// required and channels stay limited to the existing values. Owner after Wave 0: WS-D (it lives in the
// missions package next to CorridorService so the command stays in one place).
// ADR-093 2b: once the route pack content module is active the form publishes through the reviewed path (propose, then
// decide) and carries every key it does not set from the current pack; before that it writes exactly as it always did.
const keyList = z.array(z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/)).max(50);
export const guidedRoutePack = z
  .object({
    routeId: z.uuid(),
    version: z.int().positive(),
    status: z.enum(['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED']),
    // Absent means now, set by the server.
    effectiveFrom: z.iso.datetime({ offset: true }).optional(),
    reason: z.string().trim().min(3).max(500),
    missionTypes: z
      .array(z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/))
      .min(1)
      .max(50),
    // A list left out is carried from the current pack; for a route with no pack it is empty, as before.
    languages: z.array(locale).max(30).optional(),
    currencies: z.array(currency).max(30).optional(),
    timeZones: z.array(timeZone).max(30).optional(),
    localities: keyList.optional(),
    clusters: keyList.optional(),
    evidenceTypes: keyList.optional(),
    sourceCategories: keyList.optional(),
    coverage: keyList.optional(),
    requiredCapabilities: keyList.optional(),
    operatorCapabilities: keyList.optional(),
    manualChannel: z.boolean().optional(),
    // ADR-083 S1. Optional and carried unchanged into the reviewed pack; absent means the pack is exactly as before.
    sourcing: sourcingProfile.optional(),
    // The explicit "Remove sourcing profile" choice, honoured only on the reviewed path, with the form's reason.
    removeSourcingProfile: z.boolean().default(false),
    // The retry key of one publish: the same key never creates a second proposal or pack.
    commandId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => !(v.removeSourcingProfile && v.sourcing), {
    message: 'Choose either a sourcing profile or Remove sourcing profile, not both',
    path: ['removeSourcingProfile'],
  });
export type GuidedRoutePack = z.input<typeof guidedRoutePack>;
const formListKeys = [
  'languages',
  'currencies',
  'timeZones',
  'localities',
  'clusters',
  'evidenceTypes',
  'sourceCategories',
  'coverage',
  'requiredCapabilities',
  'operatorCapabilities',
] as const satisfies readonly SheetLockedKey[];

// With no current pack this is exactly the configuration the form always wrote: every key it does not set is empty, null or
// true, and the channel is SYNTHETIC unless the manual channel is chosen.
export function routePackConfiguration(
  v: z.infer<typeof guidedRoutePack>,
  current: RouteConfiguration | null = null,
): RouteConfiguration {
  const set: Partial<Pick<RouteConfiguration, SheetLockedKey>> = { missionTypes: v.missionTypes };
  for (const key of formListKeys) if (v[key] !== undefined) Object.assign(set, { [key]: v[key] });
  if (v.manualChannel !== undefined || !current)
    set.channels = v.manualChannel ? ['MANUAL'] : ['SYNTHETIC'];
  const configuration = carriedConfiguration(current, set, {
    removeSourcing: v.removeSourcingProfile,
  });
  return v.sourcing ? { ...configuration, sourcing: v.sourcing } : configuration;
}

type PublishDeps = { operations: OperationsService; content: RoutePackContentService };
// The one reviewed publish the form, the sheet and the editor share: propose, then decide PUBLISH, by the same person
// (ADR-093 I). Every step id comes from the command id, so a retry with the same command id reuses an existing proposal and
// the decision replays, and nothing is created twice.
export async function publishReviewed(
  deps: PublishDeps,
  ctx: RequestContext,
  input: {
    commandId: string;
    routeId: string;
    status: PackStatus;
    configuration: RouteConfiguration;
    reason: string;
    effectiveFrom?: string;
  },
): Promise<{ proposalId: string; packId: string; version: number; duplicate: boolean }> {
  const proposalId = commandStepId(input.commandId, 'propose');
  const packId = commandStepId(input.commandId, 'pack');
  const decisionId = commandStepId(input.commandId, 'decide');
  const check = await deps.content.goLive(ctx, {
    routeId: input.routeId,
    pack: { status: input.status, configuration: input.configuration },
  });
  if (!check.ok) throw new DomainError(goLiveMessage(check), 409, check.code);
  const duplicate = await deps.content.proposalExists(ctx, proposalId);
  let version: number | undefined;
  if (!duplicate) {
    const [route] = (await deps.content.overview(ctx, { routeIds: [input.routeId] })).routes;
    if (!route) throw new DomainError('Route unavailable', 404);
    version = (route.pack?.version ?? 0) + 1;
    await deps.operations.command(ctx, {
      id: proposalId,
      action: 'propose',
      basePackId: route.pack?.id ?? null,
      pack: {
        id: packId,
        routeId: input.routeId,
        version,
        status: input.status,
        effectiveFrom: input.effectiveFrom ?? new Date().toISOString(),
        reason: input.reason,
        configuration: input.configuration,
      },
      reason: input.reason,
    });
  }
  await deps.operations.command(ctx, {
    id: decisionId,
    action: 'decide',
    proposalId,
    decision: 'PUBLISH',
    reason: input.reason,
  });
  // A retry reads the version of the pack it published the first time.
  version ??= (await deps.content.packHistory(ctx, { routeId: input.routeId })).find(
    (pack) => pack.packId === packId,
  )?.version;
  if (version === undefined) throw new DomainError('Route pack unavailable', 404);
  return { proposalId, packId, version, duplicate };
}

export async function createRoutePack(
  deps: PublishDeps & { corridors: CorridorService },
  ctx: RequestContext,
  input: unknown,
) {
  const v = guidedRoutePack.parse(input);
  const capabilities = await deps.content.capabilities(ctx);
  if (!capabilities.routePackForm || !capabilities.contentInstalled)
    return deps.corridors.appendPack(ctx, {
      id: randomUUID(),
      routeId: v.routeId,
      version: v.version,
      status: v.status,
      effectiveFrom: v.effectiveFrom ?? new Date().toISOString(),
      reason: v.reason,
      configuration: routePackConfiguration(v),
    });
  const [route] = (await deps.content.overview(ctx, { routeIds: [v.routeId] })).routes;
  if (!route) throw new DomainError('Route unavailable', 404);
  const published = await publishReviewed(deps, ctx, {
    commandId: v.commandId ?? randomUUID(),
    routeId: v.routeId,
    status: v.status,
    configuration: routePackConfiguration(v, route.pack?.configuration ?? null),
    reason: v.reason,
    effectiveFrom: v.effectiveFrom,
  });
  return {
    id: published.packId,
    version: published.version,
    proposalId: published.proposalId,
    duplicate: published.duplicate,
  };
}
