'use client';

import { useId, useState, type Dispatch } from 'react';
import { TalkLink } from './home-talk';
import { HomeV43Review } from './home-v43-review';
import { useT } from './language-provider';
import { placeText } from './place-words';
import {
  needLimit,
  originCodes,
  placeName,
  targetOptions,
  timings,
  v43,
} from '../lib/home-v43-data';
import { helpHref, requestHref } from '../lib/home-v43-note';
import type { HomeV43Event, HomeV43State } from '../lib/home-v43-state';
import { briefGoals, type GoalKey } from '../lib/home-routes-data';
import { fill } from '../lib/i18n/fill';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v4.4 request sheet (design approved 27 Nov 2026): the request form in four short steps, one question each
// (what you need, which market, when, what to add), in the order of the form it replaces. It holds the same state and
// sends nothing: the last step opens the same review the v4.3 form opened, and the link inside it is built by the
// same functions. Back goes one step; on the first step the same control cancels and closes the sheet.
const total = 4;

export function HomeV44Sheet({
  state,
  dispatch,
  whatsapp,
  onCancel,
}: {
  state: HomeV43State;
  dispatch: Dispatch<HomeV43Event>;
  whatsapp: string | null;
  onCancel: () => void;
}) {
  const t = useT();
  const ids = useId();
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<null | 'normal' | 'help'>(null);
  const say = (key: MessageKey) => t(key);
  const jobOf = (goal: GoalKey) => t(v43(`brief.job.${goal}.label`));
  const timing = state.timing ? t(`home.b3.br.when.${state.timing}` as MessageKey) : '';
  const titles = [
    t(v43('brief.f.job')),
    t(v43('brief.f.to')),
    t(v43('brief.f.timing')),
    t(v43('brief.f.note')),
  ];
  const last = step === total - 1;
  const option = (selected: boolean, label: string, onPick: () => void) => (
    <button
      key={label}
      type="button"
      role="radio"
      aria-checked={selected}
      className="hv7-opt"
      onClick={onPick}
    >
      <span>{label}</span>
      <span className="hv7-opt-mark" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
    </button>
  );
  return (
    <section className="hv7-steps" id="brief" aria-labelledby={`${ids}-title`}>
      <div className="hv7-steps-bar">
        <button
          type="button"
          className="hv7-steps-back"
          onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
        >
          {t(step === 0 ? 'home.v44.sheet.cancel' : 'home.v44.sheet.back')}
        </button>
        <span className="hv7-steps-count">
          {fill(t('home.v44.sheet.step'), { n: String(step + 1), total: String(total) })}
        </span>
      </div>
      <div className="hv7-steps-dots" aria-hidden="true">
        {titles.map((title, index) => (
          <i key={title} data-on={index <= step ? '' : undefined} />
        ))}
      </div>
      <h2 className="hv7-steps-title" id={`${ids}-title`}>
        {titles[step]}
      </h2>
      <div className="hv7-steps-body" key={step}>
        {step === 0 ? (
          <div
            className="hv7-opts"
            role="radiogroup"
            aria-label={titles[0]}
            id="home-brief-job"
            tabIndex={-1}
          >
            {briefGoals.map((goal) =>
              option(state.goal === goal, placeText(jobOf(goal), t), () =>
                dispatch({ type: 'brief', field: 'goal', value: goal }),
              ),
            )}
          </div>
        ) : null}
        {step === 1 ? (
          <>
            <div className="hv7-opts" role="radiogroup" aria-label={titles[1]}>
              {targetOptions(state.origin).map((code) =>
                option(state.target === code, t(placeName[code]), () =>
                  dispatch({ type: 'brief', field: 'target', value: code }),
                ),
              )}
            </div>
            <div className="field hv7-base">
              <label htmlFor={`${ids}-from`}>{t('home.v44.sheet.base')}</label>
              <select
                id={`${ids}-from`}
                value={state.origin}
                onChange={(event) =>
                  dispatch({
                    type: 'brief',
                    field: 'origin',
                    value: event.target.value as HomeV43State['origin'],
                  })
                }
              >
                {originCodes.map((code) => (
                  <option key={code} value={code}>
                    {t(placeName[code])}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <div className="hv7-opts" role="radiogroup" aria-label={titles[2]}>
            {timings.map((n) =>
              option(state.timing === n, t(`home.b3.br.when.${n}` as MessageKey), () =>
                dispatch({ type: 'brief', field: 'timing', value: n }),
              ),
            )}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="field">
            <label htmlFor={`${ids}-note`} className="sr-only">
              {titles[3]}
            </label>
            <textarea
              id={`${ids}-note`}
              maxLength={needLimit}
              rows={5}
              value={state.need}
              placeholder={placeText(t(v43(`brief.job.${state.goal}.hint`)), t)}
              onChange={(event) =>
                dispatch({ type: 'brief', field: 'need', value: event.target.value })
              }
            />
            <p className="hv7-help">{t('home.b3.br.need.help')}</p>
          </div>
        ) : null}
      </div>
      <p className="hv7-steps-sum">
        {[
          placeText(jobOf(state.goal), t),
          t(placeName[state.target]),
          timing || t(v43('brief.tbd')),
        ].join(' · ')}
      </p>
      <div className="hv7-steps-actions">
        {last ? (
          <button
            type="button"
            className="hv7-btn"
            id="brief-start"
            data-start-action
            onClick={() => setReview('normal')}
          >
            {t(v43('brief.review'))}
          </button>
        ) : (
          <button
            type="button"
            className="hv7-btn"
            data-start-action
            onClick={() => setStep(step + 1)}
          >
            {t('home.v44.sheet.next')}
          </button>
        )}
        {last ? (
          <>
            <button
              type="button"
              className="hv7-btn hv7-btn-2"
              data-start-action
              onClick={() => setReview('help')}
            >
              {t(v43('brief.help'))}
            </button>
            <TalkLink href={whatsapp} />
          </>
        ) : null}
      </div>
      <p className="hv7-help">{t(v43('brief.note.line'))}</p>
      <HomeV43Review
        open={review !== null}
        help={review === 'help'}
        origin={state.origin}
        target={state.target}
        title={placeText(jobOf(state.goal), t)}
        timing={timing}
        need={state.need}
        href={review === 'help' ? helpHref(say, state) : requestHref(say, state)}
        onClose={() => setReview(null)}
      />
    </section>
  );
}
