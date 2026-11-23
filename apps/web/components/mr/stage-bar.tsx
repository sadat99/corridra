import './stage-bar.css';
import './stage-bar-room.css';
import { CorridraIcon } from '../corridra-icon';
import { fill } from '../../lib/i18n/fill';
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
  named = false,
  note,
  variant,
  stepLang,
}: {
  /** The mission status a customer may read, exactly as returned (for example `MEETINGS`). */
  status: string;
  records?: RoadRecords;
  labels?: RoadLabels;
  /** What the bar is about, for assistive technology (for example the request title). */
  name?: string;
  /** Show each stage's name under its segment (Home's request card). The bar is unchanged otherwise. */
  named?: boolean;
  /** A short fact that follows the stage on the same line ("8 companies shortlisted"). */
  note?: string;
  /**
   * `room`: the Room's stage heading, a shape and a word for every stage, and one line for every stage in road order.
   * Left out, the bar is exactly as every other screen draws it.
   */
  variant?: 'room';
  /** Language of the "Step N of M" words when they are not yet reviewed in the reader's language. */
  stepLang?: string;
}) {
  const marker = statusToRoadStep(status);
  const states = roadStates(marker, records);
  const aside =
    marker.kind === 'aside'
      ? marker.reason === 'unknown'
        ? `${labels.asides.unknown} ${marker.status.replaceAll('_', ' ').toLowerCase()}`
        : labels.asides[marker.reason]
      : null;
  if (variant === 'room') {
    return (
      <div className="mr-stage-wrap" data-variant="room">
        {marker.kind === 'marker' ? (
          <h3 className="mr-stage-heading">
            <bdi lang={stepLang} dir={stepLang ? 'ltr' : undefined}>
              {fill(labels.stepOf, {
                n: String(roadSteps.indexOf(marker.step) + 1),
                total: String(roadSteps.length),
              })}
              :
            </bdi>{' '}
            {labels.steps[marker.step]}
          </h3>
        ) : null}
        <ol className="mr-stage" aria-label={name ?? labels.title}>
          {roadSteps.map((step: RoadStep) => {
            const state = states[step];
            const shown = state === 'notTracked' ? 'grey' : state;
            const spoken = `, ${labels.states[state]}`;
            return (
              <li
                key={step}
                data-state={shown}
                data-shape={state}
                aria-current={state === 'now' ? 'step' : undefined}
              >
                <span className="mr-stage-shape" aria-hidden="true">
                  {state === 'done' ? <CorridraIcon name="check" /> : null}
                </span>
                <span className="mr-stage-name" aria-hidden="true">
                  {labels.steps[step]}
                </span>
                <span className="mr-stage-state" aria-hidden="true">
                  {labels.states[state]}
                </span>
                <span className="sr-only">
                  {labels.steps[step]}
                  {spoken}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mr-stage-lines" aria-hidden="true">
          {roadSteps.map((step: RoadStep) => (
            <p key={step} data-step={step} data-state={states[step]}>
              <b>{labels.steps[step]}</b>: {labels.states[states[step]]}
            </p>
          ))}
        </div>
        {aside ? <p className="mr-stage-line">{aside}</p> : null}
      </div>
    );
  }
  return (
    <div className="mr-stage-wrap" data-named={named ? 'true' : undefined}>
      <ol className="mr-stage" aria-label={name ?? labels.title}>
        {roadSteps.map((step: RoadStep) => {
          const state = states[step];
          // Only a done or current stage has words for its state; every other segment is plain grey.
          const shown =
            state === 'done' || state === 'now' ? state : state === 'later' ? 'later' : 'grey';
          return (
            <li key={step} data-state={shown} aria-current={state === 'now' ? 'step' : undefined}>
              {named ? (
                <span className="mr-stage-name" aria-hidden="true">
                  {labels.steps[step]}
                </span>
              ) : null}
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
          named ? (
            <>
              Stage {roadSteps.indexOf(marker.step) + 1} of {roadSteps.length}:{' '}
              <b>{labels.steps[marker.step]}</b>
            </>
          ) : (
            <>
              Stage: <b>{labels.steps[marker.step]}</b>
            </>
          )
        ) : (
          aside
        )}
        {note ? ` · ${note}` : null}
      </p>
    </div>
  );
}
