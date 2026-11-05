import './stage-bar.css';
import { mrLabels } from './labels';
import {
  roadSteps,
  roadStates,
  statusToRoadStep,
  type RoadRecords,
  type RoadStep,
} from './road-status';

type RoadLabels = typeof mrLabels.road;

/**
 * Where one request stands, as a slim bar of six segments. It reads the same marker as the Road (the mission
 * status a customer may already read), so the two never disagree. A stage with no record behind it is a plain
 * grey segment with no words: it never says "not tracked yet". A paused, cancelled or unknown request has no
 * current segment and says so in one line, never a guess. Shape carries the state as well as colour: the
 * current segment is taller.
 */
export function StageBar({
  status,
  records = { compare: false, decide: false },
  labels = mrLabels.road,
  name,
}: {
  /** The mission status a customer may read, exactly as returned (for example `MEETINGS`). */
  status: string;
  records?: RoadRecords;
  labels?: RoadLabels;
  /** What the bar is about, for assistive technology (for example the request title). */
  name?: string;
}) {
  const marker = statusToRoadStep(status);
  const states = roadStates(marker, records);
  const aside =
    marker.kind === 'aside'
      ? marker.reason === 'unknown'
        ? `${labels.asides.unknown} ${marker.status.replaceAll('_', ' ').toLowerCase()}`
        : labels.asides[marker.reason]
      : null;
  return (
    <div className="mr-stage-wrap">
      <ol className="mr-stage" aria-label={name ?? labels.title}>
        {roadSteps.map((step: RoadStep) => {
          const state = states[step];
          // Only a done or current stage has words for its state; every other segment is plain grey.
          const shown =
            state === 'done' || state === 'now' ? state : state === 'later' ? 'later' : 'grey';
          return (
            <li key={step} data-state={shown} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="sr-only">
                {labels.steps[step]}
                {state === 'done' || state === 'now' ? `, ${labels.states[state]}` : ''}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mr-stage-line">
        {marker.kind === 'marker' ? (
          <>
            Stage: <b>{labels.steps[marker.step]}</b>
          </>
        ) : (
          aside
        )}
      </p>
    </div>
  );
}
