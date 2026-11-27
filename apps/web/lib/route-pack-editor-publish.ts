import type { GoLiveWarning } from '@corridra/domain/route-pack-standard';
import type {
  RoutePackChangeBody,
  RoutePackChangePreview,
  RoutePackChangePublished,
} from '@corridra/missions/route-pack-form';

// Types only come from the @corridra packages (they are erased), so a test runner that does not transform package specifiers can
// load this file. ADR-093 Phase 3, PR 3a: what the publish action of the route pack editor, route-pack-publish, takes and
// answers. The handler in api/team-control/[action]/route.ts checks the switch, the 2b marker and the method first, reads the
// body with a bounded reader, then calls the route pack form; this file holds the name, the types and the projection of the
// answers, so no pack id, route id, reason or actor id leaves the server.
export const routePackPublishAction = 'route-pack-publish' as const;
export const isRoutePackPublishAction = (action: string): action is typeof routePackPublishAction =>
  action === routePackPublishAction;

/**
 * The request body: a preview or a publish of one settings change or one status change. change.commandId is the idempotency
 * key (a retry of the same publish sends the same id) and change.version is the pack version read plus 1.
 */
export type PackChangeBody = RoutePackChangeBody;
/** 200: what publishing would do. Nothing is written. */
export type PackPreview = {
  kind: 'settings' | 'status';
  statusFrom: RoutePackChangePreview['statusFrom'];
  statusTo: RoutePackChangePreview['statusTo'];
  /** The configuration keys the new version sets differently, a removed sourcing block included. */
  changedKeys: string[];
  /** Null for a route with no pack yet. */
  baseVersion: number | null;
  newVersion: number;
  historicalAssignmentsPreserved: number;
  /** Cautions of the go-live check, never refusals. */
  warnings: GoLiveWarning[];
  /** The one refusal of the go-live check: publishing this change would be refused for these rows. */
  blocked: { code: 'ROUTE_PACK_LOCKED_CORE_EMPTIED'; keys: string[] } | null;
  /** False until the one-person publication module is installed: then a second owner must publish the proposal. */
  onePersonPublication: boolean;
  /** Expired policies a move to Paused drops, by name. */
  removedPolicies: string[];
};
/** 201 for a new version, 200 for an exact replay (duplicate). */
export type PackPublished = {
  version: number;
  duplicate: boolean;
  warnings: GoLiveWarning[];
  removedPolicies: string[];
};

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// A policy the server could not name is named by its id; ids stay on the server, so such a name is left out.
export const policyNames = (names: readonly string[]) =>
  names.filter((name) => !uuidPattern.test(name));
const copiedWarnings = (warnings: readonly GoLiveWarning[]) =>
  warnings.map(({ code, keys }) => ({ code, keys: [...keys] }));

export function packPreviewAnswer(result: RoutePackChangePreview): PackPreview {
  return {
    kind: result.kind,
    statusFrom: result.statusFrom,
    statusTo: result.statusTo,
    changedKeys: [...result.changedKeys],
    baseVersion: result.baseVersion,
    newVersion: result.newVersion,
    historicalAssignmentsPreserved: result.historicalAssignmentsPreserved,
    warnings: copiedWarnings(result.warnings),
    blocked: result.blocked ? { code: result.blocked.code, keys: [...result.blocked.keys] } : null,
    onePersonPublication: result.onePersonPublication,
    removedPolicies: policyNames(result.removedPolicies),
  };
}
export function packPublishedAnswer(result: RoutePackChangePublished): PackPublished {
  return {
    version: result.version,
    duplicate: result.duplicate,
    warnings: copiedWarnings(result.warnings),
    removedPolicies: policyNames(result.removedPolicies),
  };
}
