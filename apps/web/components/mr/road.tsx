import './road.css';
import './scripts.css';
import './holder-badge.css';
import { Explain } from './explain';
import { mrLabels } from './labels';
import { HolderBadge } from './holder-badge';
import { holders, type Holder } from './types';
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
  decorative = false,
  holder,
}: {
  /** The mission status a customer may read, exactly as returned (for example `MEETINGS`). */
  status: string;
  records?: RoadRecords;
  labels?: RoadLabels;
  showLegend?: boolean;
  /**
   * A picture of the Road inside a read-only sample (the operator view-as stage): the legend keeps its
   * shapes and words but renders no control, so nothing in the sample can be pressed or focused.
   */
  decorative?: boolean;
  /**
   * Who holds the Now step, from a real record. Only then does the Now step open into a card with the
   * holder and the step's one sentence. With no holder the plain sentence stays: no holder is invented.
   */
  holder?: Holder;
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
                <span className="mr-road-line">
                  <b>{labels.steps[step]}</b>
                  <span className="mr-road-state">{labels.states[state]}</span>
                </span>
                {detail && holder ? (
                  <span className="mr-road-now">
                    <HolderBadge holder={holder} />
                    <span className="mr-road-now-sentence">{detail}</span>
                  </span>
                ) : detail ? (
                  <span className="mr-road-sub">{detail}</span>
                ) : null}
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
            {legendStates.map((state) =>
              decorative ? (
                <span key={state} className="mr-road-key-static">
                  <span className="mr-road-key" data-key={state} aria-hidden="true" />
                  {labels.states[state]}
                </span>
              ) : (
                <Explain key={state} name={labels.states[state]} text={labels.hints[state]}>
                  <span className="mr-road-key" data-key={state} />
                </Explain>
              ),
            )}
          </div>
          <div className="mr-road-keys" data-keys="holders">
            {holders.map((holder) =>
              decorative ? (
                <span key={holder} className="mr-road-key-static">
                  <span className="mr-holder-shape" data-holder={holder} aria-hidden="true" />
                  {labels.holders[holder].name}
                </span>
              ) : (
                <Explain
                  key={holder}
                  name={labels.holders[holder].name}
                  text={labels.holders[holder].text}
                >
                  <span className="mr-holder-shape" data-holder={holder} />
                </Explain>
              ),
            )}
          </div>
          <p className="mr-road-legend-note">{labels.legend}</p>
        </div>
      ) : null}
    </div>
  );
}
