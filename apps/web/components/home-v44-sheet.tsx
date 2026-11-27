'use client';

import Link from 'next/link';
import { useId, useState, type Dispatch } from 'react';
import { DotMap, type SpotKey } from './home-v44-dotmap';
import { useT } from './language-provider';
import { placeText } from './place-words';
import { needLimit, placeName, targetOptions, timings, v43 } from '../lib/home-v43-data';
import { requestHref } from '../lib/home-v43-note';
import type { HomeV43Event, HomeV43State } from '../lib/home-v43-state';
import { briefGoals, goalRoute, type GoalKey } from '../lib/home-routes-data';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v7 request sheet (owner-approved canvas board "Home v8", 27 Nov 2026): a wide two-pane window. The left
// pane is the request taking shape (a map that follows the chosen market, and a summary that follows every choice); the
// right pane asks one question per step as large cards (goal, market, timing, note), then a check with an Edit link on
// each row. The last button continues to Corridra: it is the same link the old review built, so nothing is sent from
// here. Back goes one step; on the first step the same control cancels and closes the sheet.
const stepNames = ['Goal', 'Market', 'Timing', 'Note'] as const;
const goalHint: Record<GoalKey, string> = {
  china: 'Suppliers and factories',
  machinery: 'Equipment for your plant',
  sell: 'Buyers and distributors that fit',
  fair: 'Meetings around the event',
  delegation: 'A trip with booked meetings',
  other: 'Describe it in your own words',
};
const timingHint = ['The fastest pace', 'Time to compare', 'A longer plan', 'No deadline yet'] as const;
const lead = {
  china: 'Suppliers are checked before anyone is contacted.',
  sell: 'Buyers are matched to your product first.',
  delegation: 'One plan, with meetings booked in order.',
  other: 'Tell us in your own words next.',
} as const;
const spotOf: Partial<Record<string, SpotKey>> = { CN: 'CN', GB: 'UK', EU: 'EU', US: 'US', AU: 'AU' };
const routeSpots: Record<'china' | 'sell' | 'delegation' | 'other', SpotKey[]> = {
  china: ['CN'],
  sell: ['EU', 'US'],
  delegation: ['CN', 'AU'],
  other: [],
};

export function HomeV44Sheet({
  state,
  dispatch,
  onCancel,
}: {
  state: HomeV43State;
  dispatch: Dispatch<HomeV43Event>;
  whatsapp?: string | null;
  onCancel: () => void;
}) {
  const t = useT();
  const ids = useId();
  const [step, setStep] = useState(0);
  const jobOf = (goal: GoalKey) => placeText(t(v43(`brief.job.${goal}.label`)), t);
  const timingOf = (n: number) => t(`home.b3.br.when.${n}` as MessageKey);
  const goal = jobOf(state.goal);
  const market = t(placeName[state.target]);
  const timing = state.timing ? timingOf(state.timing) : t(v43('brief.tbd'));
  const note = state.need.trim() ? state.need.trim().slice(0, 60) : '';
  const route = goalRoute[state.goal];
  const target = state.origin === 'BD' ? spotOf[state.target] : undefined;
  const arcs = target ? [target] : routeSpots[route];
  const mapLabels: Partial<Record<SpotKey, { name?: string }>> = { BD: {} };
  for (const key of arcs) mapLabels[key] = {};
  const review = step === stepNames.length;
  const title = review
    ? 'Check your request.'
    : ['What do you want to do?', 'Which market?', 'When do you need it?', 'Anything to add?'][step];
  const sub = [
    'Pick the closest one. You can change it later.',
    'Where should we look first?',
    'This sets the pace, nothing more.',
    'Optional. A few words are enough.',
    'Nothing is sent until reviewed.',
  ][step];
  const card = (selected: boolean, name: string, hint: string | null, onPick: () => void) => (
    <button
      key={name}
      type="button"
      role="radio"
      aria-checked={selected}
      className="hv7-opt"
      data-plain={hint ? undefined : ''}
      onClick={onPick}
    >
      <span className="hv7-ck" aria-hidden="true">
        ✓
      </span>
      <b>{name}</b>
      {hint ? <span>{hint}</span> : null}
    </button>
  );
  const rows: Array<[string, string, number]> = [
    ['Goal', goal, 0],
    ['Market', market, 1],
    ['Timing', timing, 2],
    ['Note', note || 'Optional, not added', 3],
  ];
  return (
    <section className="hv7-sheet-grid" id="brief" aria-labelledby={`${ids}-title`}>
      <aside className="hv7-side">
        <p className="hv7-eb">Your request</p>
        <p className="hv7-side-h">Taking shape as you choose.</p>
        <div className="hv7-side-map" aria-hidden="true">
          <DotMap
            view="90 0 620 250"
            routes={arcs}
            labels={mapLabels}
            flags
          />
        </div>
        <dl className="hv7-sum">
          {rows.map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd data-mute={name === 'Note' && !note ? '' : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="hv7-side-lead">{lead[route]}</p>
      </aside>
      <div className="hv7-main">
        <ol className="hv7-stepper" aria-label="Steps">
          {stepNames.map((label, index) => (
            <li
              key={label}
              data-state={index < step ? 'done' : index === step ? 'now' : 'next'}
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="hv7-sc">{index < step ? '✓' : index + 1}</span>
              <span className="hv7-st">{label}</span>
            </li>
          ))}
        </ol>
        <div className="hv7-body" key={step}>
          <h2 className="hv7-q" id={`${ids}-title`}>
            {title}
          </h2>
          <p className="hv7-q-sub">{sub}</p>
          {step === 0 ? (
            <div className="hv7-grid" role="radiogroup" aria-label={title} id="home-brief-job" tabIndex={-1}>
              {briefGoals.map((key) =>
                card(state.goal === key, jobOf(key), goalHint[key], () =>
                  dispatch({ type: 'brief', field: 'goal', value: key }),
                ),
              )}
            </div>
          ) : null}
          {step === 1 ? (
            <div className="hv7-grid" role="radiogroup" aria-label={title}>
              {targetOptions(state.origin).map((code) =>
                card(state.target === code, t(placeName[code]), null, () =>
                  dispatch({ type: 'brief', field: 'target', value: code }),
                ),
              )}
            </div>
          ) : null}
          {step === 2 ? (
            <div className="hv7-grid" role="radiogroup" aria-label={title}>
              {timings.map((n) =>
                card(state.timing === n, timingOf(n), timingHint[n - 1] ?? null, () =>
                  dispatch({ type: 'brief', field: 'timing', value: n }),
                ),
              )}
            </div>
          ) : null}
          {step === 3 ? (
            <div className="field hv7-note">
              <label htmlFor={`${ids}-note`} className="sr-only">
                {title}
              </label>
              <textarea
                id={`${ids}-note`}
                maxLength={needLimit}
                rows={6}
                value={state.need}
                placeholder={placeText(t(v43(`brief.job.${state.goal}.hint`)), t)}
                onChange={(event) => dispatch({ type: 'brief', field: 'need', value: event.target.value })}
              />
              <p className="hv7-help">{t('home.b3.br.need.help')}</p>
            </div>
          ) : null}
          {review ? (
            <dl className="hv7-card hv7-review">
              {rows.map(([name, value, at]) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                  <button type="button" className="hv7-edit" onClick={() => setStep(at)}>
                    Edit
                  </button>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <div className="hv7-foot">
          <div className="hv7-bar">
            <button
              type="button"
              className="hv7-back"
              onClick={() => (step === 0 ? onCancel() : setStep(step - 1))}
            >
              {step === 0 ? t('home.v44.sheet.cancel') : `← ${t('home.v44.sheet.back')}`}
            </button>
            {review ? (
              <Link
                prefetch={false}
                className="hv7-btn"
                id="brief-start"
                data-start-action
                href={requestHref((key: MessageKey) => t(key), state)}
              >
                Continue to Corridra
              </Link>
            ) : (
              <button
                type="button"
                className="hv7-btn"
                data-start-action
                onClick={() => setStep(step + 1)}
              >
                {step === stepNames.length - 1 ? 'Review' : t('home.v44.sheet.next')}
              </button>
            )}
          </div>
          <p className="hv7-foot-note">Takes about two minutes. Nothing is sent until reviewed.</p>
        </div>
      </div>
    </section>
  );
}
