// One customer progress model (D5) and one customer status label set (D6). The Road steps and the
// status-to-step mapping already exist in components/mr/road-status.ts and are reused, never
// duplicated. Owner after Wave 0: WS-B (mapping). The status chip component belongs to WS-E.
import {
  roadSteps,
  roadStates,
  statusToRoadStep,
  type RoadRecords,
  type RoadStep,
  type RoadStepState,
} from '../../components/mr/road-status';

export const roadStepNames: Record<RoadStep, string> = {
  define: 'Define',
  find: 'Find',
  compare: 'Compare',
  visit: 'Visit',
  decide: 'Decide',
  follow: 'Follow through',
};

/** The tone a status chip uses. Colour never carries meaning alone; the label always does. */
export type ChipTone = 'neutral' | 'waiting' | 'active' | 'done' | 'stopped';
export type CustomerStatus = { label: string; tone: ChipTone };

/**
 * D6: a request the customer has sent is never called a draft. `submitted` is true when the customer
 * has sent it (a receipt or a submitted request record exists); only an unsent guided draft is "Draft".
 */
export function customerStatusLabel(status: string, submitted: boolean): CustomerStatus {
  if (status === 'DRAFT' || status === 'QUALIFICATION')
    return submitted
      ? { label: 'Received, waiting for review', tone: 'waiting' }
      : { label: 'Draft', tone: 'neutral' };
  if (status === 'ON_HOLD') return { label: 'Paused', tone: 'stopped' };
  if (status === 'CANCELLED') return { label: 'Cancelled', tone: 'stopped' };
  if (status === 'CLOSED') return { label: 'Finished', tone: 'done' };
  const marker = statusToRoadStep(status);
  if (marker.kind === 'marker') return { label: roadStepNames[marker.step], tone: 'active' };
  return { label: 'In progress', tone: 'active' };
}

export type CustomerRoad = {
  steps: { step: RoadStep; name: string; state: RoadStepState }[];
  status: CustomerStatus;
};

/** The six Road steps with their state, plus the status label, for any customer-facing view. */
export function customerRoad(mission: {
  status: string;
  submitted: boolean;
  records?: Partial<RoadRecords>;
}): CustomerRoad {
  const states = roadStates(statusToRoadStep(mission.status), {
    compare: mission.records?.compare ?? false,
    decide: mission.records?.decide ?? false,
  });
  return {
    steps: roadSteps.map((step) => ({ step, name: roadStepNames[step], state: states[step] })),
    status: customerStatusLabel(mission.status, mission.submitted),
  };
}
