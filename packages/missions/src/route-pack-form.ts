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
  goLiveWarningCodes,
  reasonWithRemovedPolicies,
  recordsRemovedPolicies,
  routePackWords,
  type GoLiveWarning,
  type PackStatus,
  type SheetLockedKey,
} from '@corridra/domain/route-pack-standard';
import type { CorridorService } from './corridors';
import type { OperationsService } from './operations';
import {
  commandStepId,
  warningsOrRefuse,
  type ExistingProposal,
  type RoutePackContentService,
} from './route-pack-content';

// createRoutePack (commercial readiness program, 5.2, CQ-66). Takes guided form input and builds the
// existing reviewed route pack command on the server. The person never types JSON. Review stays
// required and channels stay limited to the existing values. Owner after Wave 0: WS-D (it lives in the
// missions package next to CorridorService so the command stays in one place).
// ADR-093 2b: once the route pack content module is active the form publishes through the reviewed path (propose, then
// decide) and carries every key it does not set from the current pack; before that it writes exactly as it always did.
// The form's input as it was before 2b, byte for byte, still the only shape accepted until the module is active.
export const legacyGuidedRoutePack = z
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
    // ADR-083 S1. Optional and carried unchanged into the reviewed pack; absent means the pack is exactly as before.
    sourcing: sourcingProfile.optional(),
  })
  .strict();
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
// The go-live warnings a PUBLISH decision keeps with its command result; a decision recorded before them carries none.
const decisionResult = z.object({
  warnings: z
    .array(
      z.object({
        code: z.enum(goLiveWarningCodes),
        keys: z.array(z.string()),
      }),
    )
    .default([]),
});
const commandReused = () =>
  new DomainError(routePackWords.commandReused, 409, 'ROUTE_PACK_COMMAND_REUSED');
// A retry may reuse the proposal stored under its command id only when it carries the same route, status, reason and
// configuration.
function sameProposal(
  existing: ExistingProposal,
  input: { routeId: string; status: PackStatus; reason: string; configuration: RouteConfiguration },
) {
  return (
    existing.pack.routeId === input.routeId &&
    existing.pack.status === input.status &&
    existing.reason === input.reason &&
    isDeepStrictEqual(comparable(existing.pack.configuration), comparable(input.configuration))
  );
}
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
): Promise<{
  proposalId: string;
  packId: string;
  version: number;
  duplicate: boolean;
  warnings: GoLiveWarning[];
}> {
  const proposalId = commandStepId(input.commandId, 'propose');
  const decisionId = commandStepId(input.commandId, 'decide');
  const reason = input.reason.trim();
  const existing = await deps.content.proposalOf(ctx, proposalId);
  let pack: { id: string; version: number };
  if (existing) {
    if (
      !sameProposal(existing, {
        routeId: input.routeId,
        status: input.status,
        reason,
        configuration: input.configuration,
      })
    )
      throw commandReused();
    pack = existing.pack;
  } else {
    // Refused here, before the proposal, so a refused publish writes nothing; the decision judges again under the lock.
    warningsOrRefuse(
      await deps.content.goLive(ctx, {
        routeId: input.routeId,
        pack: { status: input.status, configuration: input.configuration },
      }),
    );
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
  // A retry under an existing proposal either finds the pack already published (a duplicate: nothing changes now) or
  // publishes it now, after an earlier decision was refused.
  const publishedBefore =
    existing !== null &&
    (await deps.content.packHistory(ctx, { routeId: input.routeId })).some(
      (published) => published.packId === pack.id,
    );
  let decided: unknown;
  try {
    decided = await deps.operations.command(ctx, {
      id: decisionId,
      action: 'decide',
      proposalId,
      decision: 'PUBLISH',
      reason,
    });
  } catch (error) {
    // Propose and decide are two transactions: a refused decision leaves the proposal, so say so and how to finish. Any
    // other failure keeps its own status and log.
    if (error instanceof DomainError)
      throw new DomainError(
        `${error.message} ${routePackWords.notPublished}`,
        error.status,
        error.code,
      );
    throw error;
  }
  return {
    proposalId,
    packId: pack.id,
    version: pack.version,
    duplicate: publishedBefore,
    warnings: decisionResult.parse(decided).warnings,
  };
}

// The reason a publish records: a PAUSED publish that dropped expired policies says so, the same for the proposal, the
// decision and the pack. A retry after it finds the policies gone already, so it keeps the reason recorded the first time.
async function recordedReason(
  deps: PublishDeps,
  ctx: RequestContext,
  commandId: string,
  reason: string,
  removedNames: string[],
) {
  const existing = await deps.content.proposalOf(ctx, commandStepId(commandId, 'propose'));
  return {
    existing,
    reason:
      existing && !removedNames.length && recordsRemovedPolicies(existing.reason, reason)
        ? existing.reason
        : reasonWithRemovedPolicies(reason, removedNames),
  };
}

// The status change (ADR-093 B): the current configuration, read on the server, published again with only a new status
// through the reviewed path. It takes no configuration, so nothing edited can ride along; only a move to PAUSED drops
// expired policy references.
const routeStatusChange = z
  .object({
    commandId: z.uuid(),
    routeId: z.uuid(),
    status: z.enum(['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED']),
    reason: z.string().trim().min(3).max(500),
    expectedBasePackId: z.uuid().nullable().optional(),
  })
  .strict();
export async function changeRouteStatus(deps: PublishDeps, ctx: RequestContext, input: unknown) {
  const v = routeStatusChange.parse(input);
  const [route] = (await deps.content.overview(ctx, { routeIds: [v.routeId] })).routes;
  if (!route?.pack) throw new DomainError('Route unavailable', 404);
  const { configuration, removedRefs, removedNames } = await deps.content.withoutExpiredRefs(
    ctx,
    route.pack.configuration,
    v.status,
  );
  const { reason } = await recordedReason(deps, ctx, v.commandId, v.reason, removedNames);
  const published = await publishReviewed(deps, ctx, {
    commandId: v.commandId,
    routeId: v.routeId,
    status: v.status,
    configuration,
    reason,
    expectedBasePackId: v.expectedBasePackId === undefined ? route.pack.id : v.expectedBasePackId,
  });
  return { ...published, removedRefs, removedPolicies: removedNames };
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
  const capabilities = await deps.content.capabilities(ctx);
  // Until the module is active the form accepts exactly the input it always did and writes as it always did.
  if (!capabilities.routePackForm || !capabilities.contentInstalled) {
    const legacy = legacyGuidedRoutePack.parse(input);
    return deps.corridors.appendPack(ctx, {
      id: randomUUID(),
      routeId: legacy.routeId,
      version: legacy.version,
      status: legacy.status,
      effectiveFrom: legacy.effectiveFrom,
      reason: legacy.reason,
      configuration: routePackConfiguration({ ...legacy, removeSourcingProfile: false }),
    });
  }
  const v = guidedRoutePack.parse(input);
  const [route] = (await deps.content.overview(ctx, { routeIds: [v.routeId] })).routes;
  if (!route) throw new DomainError('Route unavailable', 404);
  const { configuration, removedRefs, removedNames } = await deps.content.withoutExpiredRefs(
    ctx,
    routePackConfiguration(v, route.pack?.configuration ?? null),
    v.status,
  );
  const commandId = v.commandId ?? formCommandId(v, configuration);
  const { existing, reason } = await recordedReason(deps, ctx, commandId, v.reason, removedNames);
  // A form opened on an older pack is refused, as before; a retry of a publish already proposed is not.
  if (v.version !== (route.pack?.version ?? 0) + 1 && !existing) throw packChanged();
  const published = await publishReviewed(deps, ctx, {
    commandId,
    routeId: v.routeId,
    status: v.status,
    configuration,
    reason,
    effectiveFrom: v.effectiveFrom,
    expectedBasePackId: route.pack?.id ?? null,
  });
  return {
    id: published.packId,
    version: published.version,
    proposalId: published.proposalId,
    duplicate: published.duplicate,
    removedRefs,
    removedPolicies: removedNames,
    warnings: published.warnings,
  };
}

// ADR-093 Phase 3, PR 3a: the pack settings and the status of one route, changed from the route pack editor. A settings change
// sets only the keys it names and carries every other key, the status and the sourcing block from the current pack (the block
// goes only on Remove sourcing profile); a status change publishes the current configuration again with a new status. Both
// publish through publishReviewed; a preview runs the same checks first and writes nothing.
const packStatus = z.enum(['DRAFT', 'TESTING', 'LIMITED', 'ACTIVE', 'PAUSED']);
const changeBase = {
  // The retry key of one change: the same key never creates a second proposal or pack.
  commandId: z.uuid(),
  routeId: z.uuid(),
  // The pack version being written: the version read plus 1.
  version: z.int().positive(),
  reason: z.string().trim().min(3).max(500),
};
const settingsChange = z
  .object({
    kind: z.literal('settings'),
    ...changeBase,
    // A key left out is carried from the current pack; a route with no pack needs its mission types.
    missionTypes: keyList.min(1).optional(),
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
    removeSourcingProfile: z.boolean().default(false),
  })
  .strict();
const statusChange = z
  .object({ kind: z.literal('status'), ...changeBase, status: packStatus })
  .strict();
export const routePackChangeRequest = z
  .object({
    mode: z.enum(['preview', 'publish']),
    change: z.discriminatedUnion('kind', [settingsChange, statusChange]),
  })
  .strict();
export type RoutePackChangeBody = z.input<typeof routePackChangeRequest>;
export type RoutePackChange = z.infer<typeof routePackChangeRequest>['change'];
export type RoutePackChangePreview = {
  kind: RoutePackChange['kind'];
  statusFrom: PackStatus | null;
  statusTo: PackStatus;
  changedKeys: string[];
  baseVersion: number | null;
  newVersion: number;
  // True when the change is already published under its command id: publishing it again writes nothing.
  duplicate: boolean;
  historicalAssignmentsPreserved: number;
  warnings: GoLiveWarning[];
  // The one refusal of the go-live check, answered here rather than thrown, so the editor can show which rows it names.
  blocked: { code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED'; keys: string[] } | null;
  onePersonPublication: boolean;
  removedPolicies: string[];
};
export type RoutePackChangePublished = {
  version: number;
  duplicate: boolean;
  warnings: GoLiveWarning[];
  removedPolicies: string[];
};
const changeWords = {
  missionTypes: 'Choose at least one mission type.',
  noChange: 'Nothing changes in this pack. Change a setting or the status first.',
} as const;
type PackState = { status: PackStatus; configuration: RouteConfiguration };

// The configuration keys the next pack sets differently from the current one, a key it drops (the sourcing block) included.
function settingKeysChanged(current: RouteConfiguration | null, next: RouteConfiguration) {
  const keys = new Set([...Object.keys(current ?? {}), ...Object.keys(next)]) as Set<
    keyof RouteConfiguration
  >;
  return [...keys].filter((key) => !isDeepStrictEqual(current?.[key], next[key]));
}
// The status and configuration a change asks for, built on `from`.
function requestedPack(change: RoutePackChange, from: PackState | null): PackState {
  if (change.kind === 'status') {
    if (!from) throw new DomainError('Route unavailable', 404);
    return { status: change.status, configuration: from.configuration };
  }
  const status = from?.status ?? 'DRAFT';
  const missionTypes = change.missionTypes ?? from?.configuration.missionTypes;
  if (!missionTypes?.length)
    throw new DomainError(changeWords.missionTypes, 400, 'ROUTE_PACK_INVALID');
  return {
    status,
    configuration: routePackConfiguration(
      { ...change, status, missionTypes },
      from?.configuration ?? null,
    ),
  };
}
// The proposal already stored under the command id, judged against the pack in force. An unpublished proposal must stand on
// that pack, else the pack changed since; the change is then judged against it, its base. A published proposal is judged
// against the base pack it was proposed on, read with it: the change is rebuilt on that base, and its kind is told from the
// base status, since a settings change keeps the base status and a status change to the same status is refused as no change.
async function proposalStanding(
  deps: PublishDeps,
  ctx: RequestContext,
  change: RoutePackChange,
  existing: ExistingProposal,
  current: (PackState & { id: string }) | null,
): Promise<{ published: false } | { published: true; base: PackState | null }> {
  if (existing.pack.routeId !== change.routeId) throw commandReused();
  const history = await deps.content.packHistory(ctx, { routeId: change.routeId });
  if (!history.some((pack) => pack.packId === existing.pack.id)) {
    if (existing.basePackId !== (current?.id ?? null)) throw packChanged();
    return { published: false };
  }
  // A base named but not found leaves nothing to rebuild on, so the change cannot be proven the same.
  if (existing.basePackId !== null && !existing.base) throw commandReused();
  const wasStatusChange = existing.base !== null && existing.base.status !== existing.pack.status;
  if ((change.kind === 'status') !== wasStatusChange) throw commandReused();
  return { published: true, base: existing.base };
}
// The checks a preview and a publish share, in this order: the proposal read first, under config.manage (so the owner with a
// fresh authenticator check), so a person who may not change packs is refused before any route or pack is read; then the route,
// a proposal already stored under the command id, the pack asked for, expired policies, the reason to record, and the command,
// version and no-change checks.
async function prepareRoutePackChange(
  deps: PublishDeps,
  ctx: RequestContext,
  change: RoutePackChange,
) {
  const existing = await deps.content.proposalOf(ctx, commandStepId(change.commandId, 'propose'));
  const {
    capabilities,
    routes: [route],
  } = await deps.content.overview(ctx, { routeIds: [change.routeId] });
  if (!route) throw new DomainError('Route unavailable', 404);
  const current = route.pack;
  const standing = existing && (await proposalStanding(deps, ctx, change, existing, current));
  const duplicate = standing ? standing.published : false;
  const requested = requestedPack(change, standing && standing.published ? standing.base : current);
  const { configuration, removedNames } = await deps.content.withoutExpiredRefs(
    ctx,
    requested.configuration,
    requested.status,
  );
  const { reason } = await recordedReason(deps, ctx, change.commandId, change.reason, removedNames);
  const nextVersion = (current?.version ?? 0) + 1;
  if (existing) {
    if (
      existing.pack.version !== change.version ||
      !sameProposal(existing, {
        routeId: change.routeId,
        status: requested.status,
        reason,
        configuration,
      })
    )
      throw commandReused();
  } else {
    if (change.version !== nextVersion) throw packChanged();
    if (
      current &&
      current.status === requested.status &&
      isDeepStrictEqual(comparable(current.configuration), comparable(configuration))
    )
      throw new DomainError(changeWords.noChange, 409, 'ROUTE_PACK_NO_CHANGE');
  }
  return {
    current,
    duplicate,
    // A published proposal answers for its own pack and the version before it.
    statusFrom: standing?.published ? (standing.base?.status ?? null) : (current?.status ?? null),
    baseVersion:
      existing && duplicate
        ? existing.basePackId === null
          ? null
          : existing.pack.version - 1
        : (current?.version ?? null),
    newVersion: existing?.pack.version ?? nextVersion,
    nextVersion,
    status: requested.status,
    configuration,
    reason,
    removedNames,
    onePersonPublication: capabilities.onePersonPublication,
  };
}
// The historical assignments the next pack keeps, from the pack preview. It refuses a version that is no longer the next one
// without a code; that means the pack changed.
async function assignmentsPreserved(
  deps: PublishDeps,
  ctx: RequestContext,
  pack: unknown,
): Promise<number> {
  try {
    return (await deps.operations.preview(ctx, pack)).historicalAssignmentsPreserved;
  } catch (error) {
    if (error instanceof DomainError && error.status === 409 && !error.code) throw packChanged();
    throw error;
  }
}

// What publishing the change would do, read only: no proposal and no pack. The proposal read under config.manage comes first, so
// a preview needs the owner and a fresh authenticator check, as a publish does. A change already published under its command id
// answers as the duplicate it is, with no changed keys, as spec 17A says (kept by Guardian G73).
export async function previewRoutePackChange(
  deps: PublishDeps,
  ctx: RequestContext,
  change: RoutePackChange,
): Promise<RoutePackChangePreview> {
  const next = await prepareRoutePackChange(deps, ctx, change);
  // Built exactly as publishReviewed builds it, so the size check and the pack preview judge the same pack.
  const proposed = routePack.parse({
    id: commandStepId(change.commandId, 'pack'),
    routeId: change.routeId,
    version: next.nextVersion,
    status: next.status,
    effectiveFrom: new Date().toISOString(),
    reason: next.reason,
    configuration: next.configuration,
  });
  const answer = {
    kind: change.kind,
    statusFrom: next.statusFrom,
    statusTo: next.status,
    baseVersion: next.baseVersion,
    newVersion: next.newVersion,
    duplicate: next.duplicate,
    onePersonPublication: next.onePersonPublication,
    removedPolicies: next.removedNames,
  };
  if (next.duplicate)
    return {
      ...answer,
      changedKeys: [],
      historicalAssignmentsPreserved: await assignmentsPreserved(deps, ctx, proposed),
      warnings: [],
      blocked: null,
    };
  if (storedTextOctets(proposed) > proposalOctetBudget)
    throw new DomainError(routePackWords.proposalTooLarge, 400, 'ROUTE_PACK_INVALID');
  const judged = await deps.content.goLive(ctx, {
    routeId: change.routeId,
    pack: { status: next.status, configuration: next.configuration },
  });
  return {
    ...answer,
    changedKeys: settingKeysChanged(next.current?.configuration ?? null, next.configuration),
    historicalAssignmentsPreserved: await assignmentsPreserved(deps, ctx, proposed),
    warnings: judged.ok ? judged.warnings : [],
    blocked: judged.ok ? null : { code: judged.code, keys: judged.keys },
  };
}
// Publishes the change through the reviewed path, refused if a newer pack was published since the one read.
export async function publishRoutePackChange(
  deps: PublishDeps,
  ctx: RequestContext,
  change: RoutePackChange,
): Promise<RoutePackChangePublished> {
  const next = await prepareRoutePackChange(deps, ctx, change);
  const basePackId = next.current?.id ?? null;
  let published: Awaited<ReturnType<typeof publishReviewed>>;
  try {
    published = await publishReviewed(deps, ctx, {
      commandId: change.commandId,
      routeId: change.routeId,
      status: next.status,
      configuration: next.configuration,
      reason: next.reason,
      expectedBasePackId: basePackId,
    });
  } catch (error) {
    // The decision refuses, without a code, a pack published after the base was read here. Any other refusal without a code
    // (the independent reviewer before the one-person install) keeps its own words.
    if (error instanceof DomainError && error.status === 409 && !error.code) {
      const [route] = (await deps.content.overview(ctx, { routeIds: [change.routeId] })).routes;
      if ((route?.pack?.id ?? null) !== basePackId) throw packChanged();
    }
    throw error;
  }
  return {
    version: published.version,
    duplicate: published.duplicate,
    warnings: published.warnings,
    removedPolicies: next.removedNames,
  };
}
