import type { ContentDocument, GoLiveWarning } from '@corridra/domain/route-pack-standard';
import type { ContentAppendResult } from '@corridra/missions/route-pack-content';

// Types only come from the @corridra packages (they are erased), so a test runner that does not transform package specifiers can
// load this file. ADR-093 Phase 3, PR 2a: what the one write action of the route pack editor, route-pack-facts, takes and
// answers. The handler in api/team-control/[action]/route.ts checks the switch, the 2b marker and the method first, reads the
// body with a bounded reader, then calls the content service; this file holds the name, the types and the projection of the
// answer, so no record id, pack id, route id or actor id leaves the server.
export const routePackFactsAction = 'route-pack-facts' as const;
export const isRoutePackFactsAction = (action: string): action is typeof routePackFactsAction =>
  action === routePackFactsAction;

/** The request body: the whole document at the next version, one command id, one reason (3 to 500 characters). */
export type FactsSaveBody = {
  /** The command id and the idempotency key: a retry of the same save sends the same id. */
  id: string;
  routeId: string;
  /** The facts version being written: the version read plus 1. */
  version: number;
  document: ContentDocument;
  reason: string;
};
/** 201 for a new version, 200 for an exact replay (duplicate, no warnings). */
export type FactsSaved = {
  version: number;
  duplicate: boolean;
  /** Cautions of the go-live check, never refusals. */
  warnings: GoLiveWarning[];
};

export function factsSavedAnswer(
  result: Pick<ContentAppendResult, 'version' | 'duplicate' | 'warnings'>,
): FactsSaved {
  return {
    version: result.version,
    duplicate: result.duplicate,
    warnings: result.warnings.map(({ code, keys }) => ({ code, keys: [...keys] })),
  };
}
