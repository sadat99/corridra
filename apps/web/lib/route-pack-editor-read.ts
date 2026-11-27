import { z } from 'zod';
import type { RequestContext } from '@corridra/db';
import { liveStatuses, type PackStatus } from '@corridra/domain/route-pack-standard';
import type { Capabilities, RouteView } from '@corridra/missions/route-pack-content';

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
export type RouteDetail = Omit<RouteView, 'pack' | 'content'> & {
  pack: Omit<NonNullable<RouteView['pack']>, 'createdBy'> | null;
  content: Omit<NonNullable<RouteView['content']>, 'createdBy'> | null;
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
export type PackVersion = {
  packId: string;
  version: number;
  status: PackStatus;
  effectiveFrom: string;
  reason: string;
  proposalReason: string | null;
  decisionReason: string | null;
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

export function summariseRoute(route: RouteView): RouteSummary {
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
    liveWithGaps:
      !!pack && (liveStatuses as readonly PackStatus[]).includes(pack.status) && pending > 0,
  };
}
export function routeDetail(route: RouteView): RouteDetail {
  const { pack, content, ...rest } = route;
  // createdBy is a staff identifier the page has no use for.
  const withoutActor = <T extends { createdBy: string }>(row: T | null) => {
    if (!row) return null;
    const { createdBy: _actor, ...kept } = row;
    void _actor;
    return kept;
  };
  return { ...rest, pack: withoutActor(pack), content: withoutActor(content) };
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
) {
  if (action === 'route-pack-overview') {
    const asked = query.get('routeId');
    if (asked === null) {
      const overview = await service.overview(ctx);
      return {
        capabilities: overview.capabilities,
        routes: overview.routes.map(summariseRoute),
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
      packId: row.packId,
      version: row.version,
      status: row.status,
      effectiveFrom: row.effectiveFrom,
      reason: row.reason,
      proposalReason: row.proposalReason,
      decisionReason: row.decisionReason,
      reviewed: row.reviewed,
      proposedAndPublishedByYou: row.proposedAndPublishedByYou,
      proposedAndPublishedBySame: row.proposedBy !== null && row.proposedBy === row.publishedBy,
    })),
  };
}
