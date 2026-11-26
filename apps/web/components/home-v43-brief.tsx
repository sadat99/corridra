'use client';

import { useId, useState, type Dispatch } from 'react';
import { TalkLink } from './home-talk';
import { HomeV43Review } from './home-v43-review';
import { RouteSummary } from './home-v43-route-summary';
import { useT } from './language-provider';
import { PlaceWords, placeText } from './place-words';
import { Eyebrow } from './ux/example-tag';
import {
  fitLine,
  needLimit,
  originCodes,
  placeName,
  targetOptions,
  timings,
  v43,
} from '../lib/home-v43-data';
import { helpHref, requestHref } from '../lib/home-v43-note';
import type { HomeV43Event, HomeV43State } from '../lib/home-v43-state';
import { briefGoals, goalJob, type GoalKey } from '../lib/home-routes-data';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v4.3 "Tell us what you want to achieve." A real GET form to /plan, so it works before the page is ready:
// the job, the company's base, the target market and the notes go as the request form's own parameters. Once the page
// is ready the same button opens a preview first; the link inside it is built by `briefHref` alone (the job, the
// notes up to 1000 whole characters and the base and target only as a valid pair). Nothing is sent from here and a
// door never overwrites what the visitor chose or typed.
export function HomeV43Brief({
  state,
  dispatch,
  whatsapp,
}: {
  state: HomeV43State;
  dispatch: Dispatch<HomeV43Event>;
  whatsapp: string | null;
}) {
  const t = useT();
  const ids = useId();
  const [review, setReview] = useState<null | 'normal' | 'help'>(null);
  const say = (key: MessageKey) => t(key);
  const jobOf = (goal: GoalKey) => t(v43(`brief.job.${goal}.label`));
  const timing = state.timing ? t(`home.b3.br.when.${state.timing}` as MessageKey) : '';
  const need = state.need;
  const set = <E extends HomeV43Event>(event: E) => dispatch(event);
  const jobGoal = (value: string): GoalKey =>
    briefGoals.find((goal) => (goalJob[goal] ?? '') === value) ?? 'other';
  const placeOption = (
    code: (typeof originCodes)[number] | ReturnType<typeof targetOptions>[number],
  ) => (
    <option key={code} value={code}>
      {t(placeName[code])}
    </option>
  );
  return (
    <section className="hv43-band hv43-brief" id="brief" aria-labelledby="brief-title">
      <header className="hv43-head">
        <div>
          <Eyebrow>{t(v43('brief.eyebrow'))}</Eyebrow>
          <h2 id="brief-title">{t(v43('brief.title'))}</h2>
        </div>
        <p>{t(v43('brief.lead'))}</p>
      </header>
      <div className="hv43-brief-grid">
        <form
          className="hv43-form"
          method="get"
          action="/plan"
          onSubmit={(event) => {
            event.preventDefault();
            setReview('normal');
          }}
        >
          <div className="field">
            <label htmlFor="home-brief-job">{t(v43('brief.f.job'))}</label>
            <select
              id="home-brief-job"
              name="job"
              value={goalJob[state.goal] ?? ''}
              onChange={(event) =>
                set({ type: 'brief', field: 'goal', value: jobGoal(event.target.value) })
              }
            >
              {briefGoals.map((goal) => (
                <option key={goal} value={goalJob[goal] ?? ''}>
                  {placeText(jobOf(goal), t)}
                </option>
              ))}
            </select>
          </div>
          <div className="hv43-form-pair">
            <div className="field">
              <label htmlFor={`${ids}-from`}>{t(v43('brief.f.from'))}</label>
              <select
                id={`${ids}-from`}
                name="companyCountry"
                value={state.origin}
                onChange={(event) =>
                  set({
                    type: 'brief',
                    field: 'origin',
                    value: event.target.value as HomeV43State['origin'],
                  })
                }
              >
                {originCodes.map(placeOption)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`${ids}-to`}>{t(v43('brief.f.to'))}</label>
              <select
                id={`${ids}-to`}
                name="marketCode"
                value={state.target}
                onChange={(event) =>
                  set({
                    type: 'brief',
                    field: 'target',
                    value: event.target.value as HomeV43State['target'],
                  })
                }
              >
                {targetOptions(state.origin).map(placeOption)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-timing`}>{t(v43('brief.f.timing'))}</label>
            <select
              id={`${ids}-timing`}
              value={state.timing}
              onChange={(event) =>
                set({ type: 'brief', field: 'timing', value: Number(event.target.value) })
              }
            >
              <option value={0}>{t(v43('brief.timing.choose'))}</option>
              {timings.map((n) => (
                <option key={n} value={n}>
                  {t(`home.b3.br.when.${n}` as MessageKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-note`}>{t(v43('brief.f.note'))}</label>
            <textarea
              id={`${ids}-note`}
              name="note"
              maxLength={needLimit}
              rows={3}
              value={need}
              placeholder={placeText(t(v43(`brief.job.${state.goal}.hint`)), t)}
              aria-describedby={`${ids}-note-help`}
              onChange={(event) => set({ type: 'brief', field: 'need', value: event.target.value })}
            />
            <p className="hv43-help" id={`${ids}-note-help`}>
              {t('home.b3.br.need.help')}
            </p>
          </div>
          <div className="hv43-form-actions">
            <button type="submit" className="primary-link" id="brief-start" data-start-action>
              {t(v43('brief.review'))}
            </button>
            <button
              type="button"
              className="button-secondary"
              data-start-action
              onClick={() => setReview('help')}
            >
              {t(v43('brief.help'))}
            </button>
            <TalkLink href={whatsapp} />
          </div>
        </form>
        <aside className="hv43-draft" aria-labelledby={`${ids}-card`}>
          <p className="label" id={`${ids}-card`}>
            {t(v43('brief.card'))}
          </p>
          <h3>
            <PlaceWords text={jobOf(state.goal)} />
          </h3>
          <RouteSummary origin={state.origin} target={state.target} />
          <p className="hv43-fit">
            <PlaceWords
              text={t(v43(`brief.fit.${fitLine(state.origin, state.target, state.goal)}`))}
            />
          </p>
          <dl>
            <dt>{t(v43('brief.facts.timing'))}</dt>
            <dd>{timing || t(v43('brief.tbd'))}</dd>
            <dt>{t(v43('brief.facts.need'))}</dt>
            <dd className="hv43-notes">{need.trim() || t(v43('brief.notes.empty'))}</dd>
          </dl>
          <p className="hv43-note">{t(v43('brief.note.line'))}</p>
        </aside>
      </div>
      <HomeV43Review
        open={review !== null}
        help={review === 'help'}
        origin={state.origin}
        target={state.target}
        title={placeText(jobOf(state.goal), t)}
        timing={timing}
        need={need}
        href={review === 'help' ? helpHref(say, state) : requestHref(say, state)}
        onClose={() => setReview(null)}
      />
    </section>
  );
}
