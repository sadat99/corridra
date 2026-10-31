import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@corridra/db';
import type { CorridorService } from './corridors';

// assignRoute (commercial readiness program, 5.2, CQ-09). Records a route assignment for a mission
// through the existing reviewed assignment model (app.mission_route_assignment, append-only versions).
// Owner after Wave 0: WS-C.
export function assignRoute(
  corridors: CorridorService,
  ctx: RequestContext,
  missionId: string,
  routePackVersionId: string,
  details: { missionTypeId: string; version: number; reason: string },
) {
  return corridors.assign(ctx, {
    id: randomUUID(),
    missionId,
    packId: routePackVersionId,
    missionTypeId: details.missionTypeId,
    version: details.version,
    reason: details.reason,
  });
}
