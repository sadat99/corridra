import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { RequestContext } from '@corridra/db';
import { DomainError } from '@corridra/domain';
import { currency } from '@corridra/domain/opportunities';
import { locale, timeZone } from '@corridra/domain/geography';
import {
  proposalOctetBudget,
  routeConfiguration,
  routePack,
  sourcingProfile,
  storedTextOctets,
  type RouteConfiguration,
} from '@corridra/domain/corridors';
import {
  carriedConfiguration,
  goLiveMessage,
  routePackWords,
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
const packChanged = () =>
  new DomainError(routePackWords.packChanged, 409, 'ROUTE_PACK_PACK_CHANGED');
// A plain copy for comparing with a stored proposal: no undefined keys, and the same canonical values the proposal stores.
const comparable = (configuration: RouteConfiguration) =>
  JSON.parse(JSON.stringify(routeConfiguration.parse(configuration))) as unknown;
// The one reviewed publish the form, the sheet and the editor share: propose, then decide PUBLISH, by the same person
// (ADR-093 I). Every step id comes from the command id. A retry with the same command id and the same values reuses the
// proposal and the decision replays, so nothing is created twice; the same command id with other values is refused.
// expectedBasePackId, when given, is the pack the caller read: a newer pack in between is refused, not overwritten.
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
    expectedBasePackId?: string | null;
  },
): Promise<{ proposalId: string; packId: string; version: number; duplicate: boolean }> {
  const proposalId = commandStepId(input.commandId, 'propose');
  const decisionId = commandStepId(input.commandId, 'decide');
  const reason = input.reason.trim();
  const existing = await deps.content.proposalOf(ctx, proposalId);
  let pack: { id: string; version: number };
  if (existing) {
    if (
      existing.pack.routeId !== input.routeId ||
      existing.pack.status !== input.status ||
      existing.reason !== reason ||
      !isDeepStrictEqual(comparable(existing.pack.configuration), comparable(input.configuration))
    )
      throw new DomainError(routePackWords.commandReused, 409, 'ROUTE_PACK_COMMAND_REUSED');
    pack = existing.pack;
  } else {
    const check = await deps.content.goLive(ctx, {
      routeId: input.routeId,
      pack: { status: input.status, configuration: input.configuration },
    });
    if (!check.ok) throw new DomainError(goLiveMessage(check), 409, check.code);
    const [route] = (await deps.content.overview(ctx, { routeIds: [input.routeId] })).routes;
    if (!route) throw new DomainError('Route unavailable', 404);
    const basePackId = route.pack?.id ?? null;
    if (input.expectedBasePackId !== undefined && input.expectedBasePackId !== basePackId)
      throw packChanged();
    const proposed = routePack.parse({
      id: commandStepId(input.commandId, 'pack'),
      routeId: input.routeId,
      version: (route.pack?.version ?? 0) + 1,
      status: input.status,
      effectiveFrom: input.effectiveFrom ?? new Date().toISOString(),
      reason,
      configuration: input.configuration,
    });
    // The proposal table keeps at most 8192 octets; say so plainly instead of meeting the database refusal.
    if (storedTextOctets(proposed) > proposalOctetBudget)
      throw new DomainError(routePackWords.proposalTooLarge, 400, 'ROUTE_PACK_INVALID');
    await deps.operations.command(ctx, {
      id: proposalId,
      action: 'propose',
      basePackId,
      pack: proposed,
      reason,
    });
    pack = proposed;
  }
  await deps.operations.command(ctx, {
    id: decisionId,
    action: 'decide',
    proposalId,
    decision: 'PUBLISH',
    reason,
  });
  return { proposalId, packId: pack.id, version: pack.version, duplicate: existing !== null };
}

// Without a command id from the page, the form's own values name the command, so a double click publishes once.
const formCommands = 'a3e1c5d2-6b7f-4c18-9d0e-2f4b8a6c1e93';
function formCommandId(v: z.infer<typeof guidedRoutePack>, configuration: RouteConfiguration) {
  const values = createHash('sha256')
    .update(JSON.stringify([v.status, v.reason, configuration]))
    .digest('hex');
  return commandStepId(formCommands, v.routeId, String(v.version), values);
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
  const { configuration, removedRefs } = await deps.content.withoutExpiredRefs(
    ctx,
    routePackConfiguration(v, route.pack?.configuration ?? null),
    v.status,
  );
  const commandId = v.commandId ?? formCommandId(v, configuration);
  // A form opened on an older pack is refused, as before; a retry of a publish already proposed is not.
  if (
    v.version !== (route.pack?.version ?? 0) + 1 &&
    !(await deps.content.proposalExists(ctx, commandStepId(commandId, 'propose')))
  )
    throw packChanged();
  const published = await publishReviewed(deps, ctx, {
    commandId,
    routeId: v.routeId,
    status: v.status,
    configuration,
    reason: v.reason,
    effectiveFrom: v.effectiveFrom,
    expectedBasePackId: route.pack?.id ?? null,
  });
  return {
    id: published.packId,
    version: published.version,
    proposalId: published.proposalId,
    duplicate: published.duplicate,
    removedRefs,
  };
}
