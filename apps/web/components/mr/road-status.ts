/**
 * The Road: where one request stands, in six plain steps.
 *
 * The marker follows the mission status a customer may already read (the mapping is ADR-0071).
 * Compare and Decide are not driven by the status: they light only when a readable record exists
 * for the same piece of work (a delivered report, a reviewed decision disclosure). Customers cannot
 * record a decision; they read reviewed ones. Pure functions, no I/O, so every rule is testable.
 */
export const roadSteps = ['define', 'find', 'compare', 'visit', 'decide', 'follow'] as const;
export type RoadStep = (typeof roadSteps)[number];

/** The four shapes a step can take. Shape and word both say it, so colour is never the only clue. */
export type RoadStepState = 'done' | 'now' | 'later' | 'notTracked';

/** Mission statuses as defined in `packages/domain/src/missions.ts` (`missionStatus`). */
export const missionStatusNames = [
  'DRAFT',
  'QUALIFICATION',
  'ACTIVE',
  'TARGETING',
  'OUTREACH',
  'MEETINGS',
  'FOLLOW_UP',
  'COMMERCIAL_PIPELINE',
  'CLOSED',
  'CANCELLED',
  'ON_HOLD',
] as const;
export type MissionStatusName = (typeof missionStatusNames)[number];

export type RoadMarker =
  | { kind: 'marker'; step: RoadStep; status: MissionStatusName }
  | { kind: 'aside'; reason: 'on_hold' | 'cancelled' | 'unknown'; status: string };

const markerByStatus: Record<Exclude<MissionStatusName, 'ON_HOLD' | 'CANCELLED'>, RoadStep> = {
  DRAFT: 'define',
  QUALIFICATION: 'define',
  ACTIVE: 'find',
  TARGETING: 'find',
  OUTREACH: 'find',
  MEETINGS: 'visit',
  FOLLOW_UP: 'follow',
  COMMERCIAL_PIPELINE: 'follow',
  CLOSED: 'follow',
};

/**
 * ON_HOLD has no marker: the status it was paused from is not readable, so the Road says so in a
 * side note instead of guessing. CANCELLED is a side note too. An unknown status gets a plain
 * status line and no marker, so a status added later never draws a wrong step.
 */
export function statusToRoadStep(status: string): RoadMarker {
  if (status === 'ON_HOLD') return { kind: 'aside', reason: 'on_hold', status };
  if (status === 'CANCELLED') return { kind: 'aside', reason: 'cancelled', status };
  if (Object.prototype.hasOwnProperty.call(markerByStatus, status)) {
    return {
      kind: 'marker',
      step: markerByStatus[status as keyof typeof markerByStatus],
      status: status as MissionStatusName,
    };
  }
  return { kind: 'aside', reason: 'unknown', status };
}

/** Records that decide whether Compare and Decide light. Never inferred from the status. */
export type RoadRecords = { compare: boolean; decide: boolean };

/**
 * The four-shape state of each step. Before the marker is done, the marker is now, after it is
 * later. Compare and Decide are done when their record exists and otherwise "not tracked yet",
 * whatever the status says. With no marker (paused, cancelled or unknown) nothing is done or now:
 * every step is later, except a record that exists, which is a fact and stays done.
 */
export function roadStates(
  marker: RoadMarker,
  records: RoadRecords,
): Record<RoadStep, RoadStepState> {
  const at = marker.kind === 'marker' ? roadSteps.indexOf(marker.step) : -1;
  const out = {} as Record<RoadStep, RoadStepState>;
  roadSteps.forEach((step, index) => {
    if (step === 'compare') out[step] = records.compare ? 'done' : 'notTracked';
    else if (step === 'decide') out[step] = records.decide ? 'done' : 'notTracked';
    else if (at < 0) out[step] = 'later';
    else out[step] = index < at ? 'done' : index === at ? 'now' : 'later';
  });
  return out;
}

/** The index of the marker (0 to 5), or -1 when there is none. Used to prove the marker never steps back. */
export function roadMarkerIndex(marker: RoadMarker): number {
  return marker.kind === 'marker' ? roadSteps.indexOf(marker.step) : -1;
}
