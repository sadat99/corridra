import './road.css';
import './scripts.css';
import { Explain } from './explain';
import { mrLabels } from './labels';
import {
  roadSteps,
  roadStates,
  statusToRoadStep,
  type RoadMarker,
  type RoadRecords,
  type RoadStep,
  type RoadStepState,
} from './road-status';

type RoadLabels = typeof mrLabels.road;

/** The legend shows each state once, in reading order, with its shape, word and explanation. */
const legendStates: readonly RoadStepState[] = ['done', 'now', 'later', 'notTracked'];

const marks: Record<RoadStepState, (index: number) => string> = {
  done: () => '✓',
  now: (index) => String(index + 1),
  later: (index) => String(index + 1),
  notTracked: () => '–',
};

/**
 * Where one request stands, in six steps. Built on the semantics of the locked `JourneyBar`: an
 * ordered list, `aria-current="step"` on the step that is now, done markers, and the word under
 * every step. Vertical on a phone and horizontal on wide screens. Four shapes, so the state never
 * depends on colour. With no marker (paused, cancelled, unknown status) the Road says so in a side
 * note and marks nothing as now.
 */
export function Road({
  status,
  records = { compare: false, decide: false },
  labels = mrLabels.road,
  showLegend = true,
}: {
  /** The mission status a customer may read, exactly as returned (for example `MEETINGS`). */
  status: string;
  records?: RoadRecords;
  labels?: RoadLabels;
  showLegend?: boolean;
}) {
  const marker: RoadMarker = statusToRoadStep(status);
  const states = roadStates(marker, records);
  const subline =
    marker.kind === 'marker'
      ? labels.sublines[marker.status as keyof typeof labels.sublines]
      : undefined;
  const aside =
    marker.kind === 'aside'
      ? marker.reason === 'unknown'
        ? `${labels.asides.unknown} ${marker.status.replaceAll('_', ' ').toLowerCase()}`
        : labels.asides[marker.reason]
      : undefined;
  return (
    <div className="mr-road-wrap">
      <ol className="mr-road" aria-label={labels.title}>
        {roadSteps.map((step: RoadStep, index) => {
          const state = states[step];
          const detail = state === 'now' ? subline : undefined;
          return (
            <li key={step} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="mr-road-dot" aria-hidden="true">
                {marks[state](index)}
              </span>
              <span className="mr-road-text">
                <b>{labels.steps[step]}</b>
                <span className="mr-road-state">{labels.states[state]}</span>
                {detail ? <span className="mr-road-sub">{detail}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {aside ? (
        <p className="mr-road-aside" role="note">
          {aside}
        </p>
      ) : null}
      {showLegend ? (
        <div className="mr-road-legend">
          <div className="mr-road-keys">
            {legendStates.map((state) => (
              <Explain key={state} name={labels.states[state]} text={labels.hints[state]}>
                <span className="mr-road-key" data-key={state} />
              </Explain>
            ))}
          </div>
          <p className="mr-road-legend-note">{labels.legend}</p>
        </div>
      ) : null}
    </div>
  );
}
