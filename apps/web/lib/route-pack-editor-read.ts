import { z } from 'zod';
import type { RequestContext } from '@corridra/db';
import type { PackStatus } from '@corridra/domain/route-pack-standard';
import type { Capabilities, RouteView } from '@corridra/missions/route-pack-content';

// Types only come from the @corridra packages (they are erased), so a test runner that does not transform package specifiers can
// load this file. The one value it needs from the standard, which pack statuses are live, is passed in by the caller.
// ADR-093 Phase 3, PR 1 (read only): what the three read actions of the route pack editor answer. The content service is passed
// in, so this file holds only the projections and the response types; the handler in api/team-control/[action]/route.ts checks
// the switch and the 2b marker first, then calls here. Client files import the types from here with `import type` only.
//
// No actor id leaves the server: createdBy, publishedBy and proposedBy are dropped, and the one fact the page needs about them
// (whether the reader did a step, or whether one person did both) is computed here.
export const routePackReadActions = [
  'route-pack-overview',
  'route-pack-fact-history',
  'route-pack-pack-history',
] as const;
export type RoutePackReadAction = (typeof routePackReadActions)[number];
export const isRoutePackReadAction = (action: string): action is RoutePackReadAction =>
  (routePackReadActions as readonly string[]).includes(action);

/** One route in the Routes list: no document, no configuration, counts taken from the one shared completeness. */
export type RouteSummary = {
  routeId: string;
  key: string;
  origin: string;
  destination: string;
  pack: { version: number; status: PackStatus } | null;
  facts: { version: number } | null;
  core: { total: number; pending: number; stale: number };
  optionalPending: number;
  /** The pack in force is Limited use or Active and a Core field is still Pending. */
  liveWithGaps: boolean;
};
export type OverviewList = { capabilities: Capabilities; routes: RouteSummary[] };
/**
 * One route in full, with only what the page draws: no record id, no actor, no free staff text (the reasons stay in the
 * database and the history reads), and readiness without its pack id.
 */
export type RouteDetail = Pick<
  RouteView,
  'routeId' | 'key' | 'origin' | 'destination' | 'completeness'
> & {
  pack: Pick<NonNullable<RouteView['pack']>, 'version' | 'status' | 'configuration'> | null;
  content: Pick<NonNullable<RouteView['content']>, 'version' | 'document'> | null;
  readiness: { completeMissionTypes: string[] } | null;
};
export type OverviewRoute = {
  capabilities: Capabilities;
  customLabels: Record<string, string>;
  /** Null: the route is not in this workspace. */
  route: RouteDetail | null;
};
export type FactVersion = {
  id: string;
  version: number;
  packId: string | null;
  createdAt: string;
  createdByYou: boolean;
  reason: string;
};
/** One pack version for the line "last pack change": its number, its effective date and who did the two steps, in words only. */
export type PackVersion = {
  version: number;
  effectiveFrom: string;
  /** The pack went through propose and decide (the 2b reviewed path). */
  reviewed: boolean;
  proposedAndPublishedByYou: boolean;
  /** One person proposed and published it (not necessarily the reader). */
  proposedAndPublishedBySame: boolean;
};

/** The three reads of RoutePackContentService, the only part of it this file uses. */
export type RoutePackReadService = {
  overview(
    ctx: RequestContext,
    input?: { routeIds?: string[] },
  ): Promise<{
    capabilities: Capabilities;
    customLabels: Record<string, string>;
    routes: RouteView[];
  }>;
  history(
    ctx: RequestContext,
    input: { routeId: string },
  ): Promise<(FactVersion & { createdBy: string })[]>;
  packHistory(
    ctx: RequestContext,
    input: { routeId: string },
  ): Promise<
    (Omit<PackVersion, 'proposedAndPublishedBySame'> & {
      publishedBy: string;
      proposedBy: string | null;
    })[]
  >;
};

const routeId = z.uuid();

export function summariseRoute(route: RouteView, live: readonly PackStatus[]): RouteSummary {
  const { completeness, pack, content } = route;
  const total = completeness.fields.filter((row) => row.core).length;
  const pending = completeness.pendingCore.length;
  return {
    routeId: route.routeId,
    key: route.key,
    origin: route.origin,
    destination: route.destination,
    pack: pack ? { version: pack.version, status: pack.status } : null,
    facts: content ? { version: content.version } : null,
    core: { total, pending, stale: completeness.staleCore.length },
    optionalPending: completeness.pendingOptionalCount,
    liveWithGaps: !!pack && live.includes(pack.status) && pending > 0,
  };
}
export function routeDetail(route: RouteView): RouteDetail {
  const { routeId, key, origin, destination, completeness, pack, content, readiness } = route;
  return {
    routeId,
    key,
    origin,
    destination,
    completeness,
    pack: pack
      ? { version: pack.version, status: pack.status, configuration: pack.configuration }
      : null,
    content: content ? { version: content.version, document: content.document } : null,
    readiness: readiness ? { completeMissionTypes: readiness.completeMissionTypes } : null,
  };
}

/**
 * Answers one read. `query` is read only here, after the handler has passed the switch and the marker. The services keep their
 * own permission (missions.read, and audit.read for the pack history) and their own Not found as a second guard.
 */
export async function answerRoutePackRead(
  service: RoutePackReadService,
  ctx: RequestContext,
  action: RoutePackReadAction,
  query: URLSearchParams,
  /** The pack statuses that are live (the standard's `liveStatuses`). */
  live: readonly PackStatus[],
) {
  if (action === 'route-pack-overview') {
    const asked = query.get('routeId');
    if (asked === null) {
      const overview = await service.overview(ctx);
      return {
        capabilities: overview.capabilities,
        routes: overview.routes.map((route) => summariseRoute(route, live)),
      } satisfies OverviewList;
    }
    const overview = await service.overview(ctx, { routeIds: [routeId.parse(asked)] });
    const [route] = overview.routes;
    return {
      capabilities: overview.capabilities,
      customLabels: overview.customLabels,
      route: route ? routeDetail(route) : null,
    } satisfies OverviewRoute;
  }
  const wanted = routeId.parse(query.get('routeId'));
  if (action === 'route-pack-fact-history') {
    const versions = await service.history(ctx, { routeId: wanted });
    return {
      versions: versions.map(
        ({ id, version, packId, createdAt, createdByYou, reason }): FactVersion => ({
          id,
          version,
          packId,
          createdAt,
          createdByYou,
          reason,
        }),
      ),
    };
  }
  const versions = await service.packHistory(ctx, { routeId: wanted });
  return {
    versions: versions.map((row): PackVersion => ({
      version: row.version,
      effectiveFrom: row.effectiveFrom,
      reviewed: row.reviewed,
      proposedAndPublishedByYou: row.proposedAndPublishedByYou,
      proposedAndPublishedBySame: row.proposedBy !== null && row.proposedBy === row.publishedBy,
    })),
  };
}
