'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';
import { Arrow } from './arrow';
import { FactLabel } from './fact-label';
import { Flagged, type FlagCode } from './flag';
import { marketFlag } from './home-route-line';
import { useT } from './language-provider';
import { fill } from '../lib/i18n/fill';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import type { MessageKey } from '../lib/i18n/messages';
import {
  calculatorCurrencies,
  fairFits,
  fairLabels,
  marketCurrency,
  marketExamples,
  marketKeys,
  outsideLabels,
  routeHref,
  type CalculatorCurrency,
  type MarketKey,
} from '../lib/home-routes-data';

// Sell Abroad: the market selector, the worked "who is worth meeting" example and the fair-cost calculator. Every
// company is invented and tagged Example. The calculator keeps every number on this page: nothing is stored or sent,
// and no amount is ever converted between currencies.
const key = (name: string) => name as HomeRoutesKey;
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function HomeSell({
  market,
  onMarket,
}: {
  market: MarketKey;
  onMarket: (market: MarketKey) => void;
}) {
  const t = useT();
  const setMarket = onMarket;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const example = marketExamples[market];
  const rows = example.fair.map((company, index) => ({ company, index }));
  const ordered =
    step > 1
      ? [...rows].sort((a, b) => Number(!fairFits[a.index]) - Number(!fairFits[b.index]))
      : rows;
  const summary = { 1: 8, 2: 2, 3: 5 }[step];
  return (
    <section className="tr-section" id="route-sell" aria-labelledby="sell-title">
      <div className="tr-intro">
        <div>
          <p className="label ac1-rule">{t('home.tr.sl.eyebrow')}</p>
          <p className="tr-side">
            <Flagged code="bd">{t('home.country.bd')}</Flagged> {t('home.b3.to')}{' '}
            <Flagged code={marketFlag(market)}>{t(key(`home.tr.mk.${market}`))}</Flagged>
          </p>
          <h2 id="sell-title" tabIndex={-1}>
            {t('home.tr.sl.title')}
          </h2>
          <p className="tr-sub">{t('home.tr.sl.lead')}</p>
        </div>
        <div className="tr-tests">
          <p className="label">{t('home.tr.tests')}</p>
          <ul>
            {[1, 2, 3, 4].map((n) => (
              <li key={n}>{t(key(`home.tr.sl.t${n}`))}</li>
            ))}
          </ul>
        </div>
      </div>

      <fieldset className="tr-market">
        <legend>{t('home.tr.mk.legend')}</legend>
        <div className="tr-chips">
          {marketKeys.map((m) => (
            <Choice
              key={m}
              name="home-market"
              value={m}
              checked={market === m}
              onChoose={() => setMarket(m)}
              label={t(key(`home.tr.mk.${m}`))}
            />
          ))}
        </div>
        <p className="tr-market-line" aria-live="polite">
          <strong>{t(key(`home.tr.mk.${market}.line.head`))}</strong>{' '}
          {t(key(`home.tr.mk.${market}.line`))}
        </p>
      </fieldset>
      <div className="tr-block">
        <h3 className="tr-h3" id="worth-title">
          {t('home.tr.w.title')}
        </h3>
        <div className="tr-block-body">
          <p className="tr-brief">
            <span className="ac1-example-tag">{t('home.tr.w.brief')}</span>
            <span>
              <strong>{t('home.tr.w.brief.lead')}</strong> {t(key(`home.tr.mk.${market}.brief`))}
            </span>
          </p>
          <fieldset className="tr-steps">
            <legend>{t('home.tr.w.steps')}</legend>
            <div className="tr-chips">
              {([1, 2, 3] as const).map((n) => (
                <Choice
                  key={n}
                  name="home-worth-step"
                  value={String(n)}
                  checked={step === n}
                  onChoose={() => setStep(n)}
                  label={`${n}. ${t(key(`home.tr.w.step${n}`))}`}
                />
              ))}
            </div>
          </fieldset>
          <p className="tr-sum" aria-live="polite">
            <span className="tr-big">{summary}</span> {t(key(`home.tr.w.sum${step}`))}
          </p>
          <div className="tr-scroll" tabIndex={0} role="region" aria-label={t('home.tr.w.aria')}>
            <table className="tr-table tr-worth">
              <thead>
                <tr>
                  <th scope="col">{t('home.tr.w.col.company')}</th>
                  <th scope="col">{t('home.tr.w.col.fair')}</th>
                  <th scope="col">{t('home.tr.w.col.read')}</th>
                </tr>
              </thead>
              <tbody>
                {step === 3
                  ? example.outside.map((company, i) => (
                      <tr key={company.name} className="is-out">
                        <th scope="row">
                          <strong>{company.name}</strong>
                          <Place place={company.place} />
                        </th>
                        <td>
                          <span className="tr-off">{t('home.tr.w.off')}</span>
                        </td>
                        <td>
                          <p className="tr-read">
                            <span className="tr-state is-yes">{t('home.tr.w.worth')}</span>
                            <FactLabel label={outsideLabels[i]} english />
                          </p>
                          <p>{t(key(`home.tr.w.out.why.${i}`))}</p>
                          <p className="tr-small">
                            {t(key(`home.tr.w.note.o${i}`))}. {t('home.tr.w.example')}
                          </p>
                        </td>
                      </tr>
                    ))
                  : null}
                {ordered.map(({ company, index }) => {
                  const fit = fairFits[index];
                  const label = fairLabels[index];
                  return (
                    <tr key={company.name} className={step > 1 && !fit ? 'is-no' : undefined}>
                      <th scope="row">
                        <strong>{company.name}</strong>
                        <Place place={company.place} />
                      </th>
                      <td>{t(key(`home.tr.w.as.${index}`))}</td>
                      <td>
                        {step === 1 ? (
                          <span className="guide-tag" data-tone="unknown">
                            {t('home.tr.w.notChecked')}
                          </span>
                        ) : (
                          <>
                            <p className="tr-read">
                              <span className={fit ? 'tr-state is-yes' : 'tr-state is-no'}>
                                {t(fit ? 'home.tr.w.worth' : 'home.tr.w.notFit')}
                              </span>
                              {fit && label ? <FactLabel label={label} english /> : null}
                            </p>
                            <p>{t(key(`home.tr.w.why.${index}`))}</p>
                            {fit ? (
                              <p className="tr-small">
                                {t(key(`home.tr.w.note.f${index}`))}. {t('home.tr.w.example')}
                              </p>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="tr-small">
            <span className="ac1-example-tag">{t('home.tr.q.example')}</span>{' '}
            {fill(t('home.tr.w.note'), {
              selfDeclared: 'Self-declared',
              evidence: 'Evidence available',
              verified: 'Verified',
            })}
          </p>
        </div>
      </div>

      <Calculator market={market} />
      <Link prefetch={false} className="primary-link" href={routeHref.sell}>
        {t('home.tr.cta.sell')} <Arrow />
      </Link>
    </section>
  );
}

function Choice({
  name,
  value,
  checked,
  onChoose,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChoose: () => void;
  label: ReactNode;
}) {
  const id = useId();
  return (
    <span className="tr-choice">
      <input
        className="sr-only"
        type="radio"
        name={name}
        id={id}
        value={value}
        checked={checked}
        onChange={onChoose}
      />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}

const fields = [
  { id: 'people', label: 'home.tr.fc.people', whole: true, money: false },
  { id: 'days', label: 'home.tr.fc.days', whole: true, money: false },
  { id: 'stand', label: 'home.tr.fc.stand', whole: false, money: true },
  { id: 'flight', label: 'home.tr.fc.flight', whole: false, money: true },
  { id: 'hotel', label: 'home.tr.fc.hotel', whole: false, money: true },
  { id: 'samples', label: 'home.tr.fc.samples', whole: false, money: true },
  { id: 'meet', label: 'home.tr.fc.meet', whole: true, money: false },
] as const;
type FieldId = (typeof fields)[number]['id'];

function Calculator({ market }: { market: MarketKey }) {
  const t = useT();
  const prefix = useId();
  const [values, setValues] = useState<Record<FieldId, string>>({
    people: '',
    days: '',
    stand: '',
    flight: '',
    hotel: '',
    samples: '',
    meet: '',
  });
  // The currency follows the market until an amount is typed or the visitor chooses one; it never changes under typed
  // numbers, so a figure never silently changes meaning.
  const [chosen, setChosen] = useState<CalculatorCurrency | null>(null);
  const typed = (['stand', 'flight', 'hotel', 'samples'] as const).some((f) => values[f] !== '');
  const [locked, setLocked] = useState<CalculatorCurrency | null>(null);
  const currency: CalculatorCurrency = chosen ?? locked ?? marketCurrency[market];
  const money = (n: number) => `${currency} ${number.format(Math.round(n))}`;

  const errors: Partial<Record<FieldId, MessageKey>> = {};
  const read = (id: FieldId, whole: boolean): number => {
    const raw = values[id];
    if (raw === '') return 0;
    const x = Number(raw);
    let error: MessageKey | null = null;
    if (!Number.isFinite(x)) error = 'home.tr.fc.err.digits';
    else if (x < 0) error = 'home.tr.fc.err.zero';
    else if (whole && Math.floor(x) !== x) error = 'home.tr.fc.err.whole';
    else if (x >= 1e11) error = 'home.tr.fc.err.large';
    if (error) {
      errors[id] = error;
      return 0;
    }
    return x;
  };
  const people = read('people', true);
  const days = read('days', true);
  const stand = read('stand', false);
  const flights = people * read('flight', false);
  const hotel = people * days * read('hotel', false);
  const samples = read('samples', false);
  const meetings = read('meet', true);
  const total = stand + flights + hotel + samples;
  const left = fields.filter((f) => errors[f.id]).map((f) => t(f.label));
  const line = (n: number) => (n > 0 ? money(n) : t('home.tr.fc.b.none'));
  const set = (id: FieldId, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
    if (!typed && !chosen && fields.find((f) => f.id === id)?.money && value !== '')
      setLocked(marketCurrency[market]);
  };
  const half = Math.floor(meetings / 2);
  const note = chosen
    ? fill(t('home.tr.fc.cur.read'), { cur: currency })
    : typed && currency !== marketCurrency[market]
      ? fill(t('home.tr.fc.cur.kept'), { cur: currency })
      : market === 'asia'
        ? t('home.tr.fc.cur.asia')
        : `${t(key(`home.tr.fc.cur.${market}`))} ${t('home.tr.fc.cur.change')}`;
  return (
    <>
      <div className="tr-block">
        <h3 className="tr-h3" id="faircost-title">
          {t('home.tr.fc.title')}
        </h3>
        <div className="tr-block-body">
          <p className="tr-sub">{t('home.tr.fc.lead')}</p>
          <div className="tr-calc">
            <div className="tr-panel">
              <fieldset className="tr-steps">
                <legend>{t('home.tr.fc.currency')}</legend>
                <div className="tr-chips">
                  {calculatorCurrencies.map((c) => (
                    <Choice
                      key={c}
                      name="home-currency"
                      value={c}
                      checked={currency === c}
                      onChoose={() => setChosen(c)}
                      label={c}
                    />
                  ))}
                </div>
              </fieldset>
              <p className="tr-small" aria-live="polite">
                {note}
              </p>
              <div className="tr-fields">
                {fields.map((f) => {
                  const id = `${prefix}-${f.id}`;
                  return (
                    <div className="tr-field" key={f.id}>
                      <label htmlFor={id}>
                        {t(f.label)}
                        {f.money ? <span> ({currency})</span> : null}
                      </label>
                      <input
                        id={id}
                        type="number"
                        inputMode={f.whole ? 'numeric' : 'decimal'}
                        min={0}
                        step={f.whole ? 1 : 'any'}
                        value={values[f.id]}
                        aria-invalid={errors[f.id] ? true : undefined}
                        aria-describedby={`${id}-error`}
                        onChange={(event) => set(f.id, event.target.value)}
                      />
                      <p className="tr-error" id={`${id}-error`} aria-live="polite">
                        {errors[f.id] ? t(errors[f.id]!) : null}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="tr-small">{t('home.tr.fc.help')}</p>
            </div>
            <div className="tr-result" aria-live="polite">
              <p className="label">{t('home.tr.fc.result')}</p>
              <p className="tr-total">
                <small>
                  {total > 0
                    ? fill(t('home.tr.fc.total.in'), { cur: currency })
                    : t('home.tr.fc.total')}
                </small>
                {total > 0 ? money(total) : t('home.tr.fc.add')}
              </p>
              <dl className="tr-breakdown">
                <div>
                  <dt>{t('home.tr.fc.b.stand')}</dt>
                  <dd>{line(stand)}</dd>
                </div>
                <div>
                  <dt>{t('home.tr.fc.b.flights')}</dt>
                  <dd>{line(flights)}</dd>
                </div>
                <div>
                  <dt>{t('home.tr.fc.b.hotel')}</dt>
                  <dd>{line(hotel)}</dd>
                </div>
                <div>
                  <dt>{t('home.tr.fc.b.samples')}</dt>
                  <dd>{line(samples)}</dd>
                </div>
                <div>
                  <dt>{t('home.tr.fc.b.meeting')}</dt>
                  <dd>
                    {total > 0 && meetings > 0
                      ? money(total / meetings)
                      : t('home.tr.fc.b.addMeet')}
                  </dd>
                </div>
              </dl>
              {left.length ? (
                <p className="tr-warn">{fill(t('home.tr.fc.left'), { names: left.join(', ') })}</p>
              ) : null}
              <p className="tr-frame">
                {total > 0
                  ? fill(t('home.tr.fc.frame.n'), { amount: money(total) })
                  : t('home.tr.fc.frame')}
              </p>
              {total > 0 && meetings > 1 ? (
                <p className="tr-small">
                  {fill(t('home.tr.fc.half'), {
                    m: meetings,
                    each: money(total / meetings),
                    half,
                    each2: money(total / half),
                  })}
                </p>
              ) : null}
              {total > 0 && meetings === 1 ? (
                <p className="tr-small">{t('home.tr.fc.one')}</p>
              ) : null}
              <p className="tr-small">{t('home.tr.fc.after')}</p>
              <Link prefetch={false} className="primary-link" href={routeHref.sell}>
                {t('home.tr.fc.cta')} <Arrow />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Countries the example places name, for the flag beside them. A region or an Asian market shows the name only. */
const placeFlags: Record<string, FlagCode> = {
  Spain: 'es',
  France: 'fr',
  Italy: 'it',
  'United Kingdom': 'gb',
  'United States': 'us',
  Australia: 'au',
};

function Place({ place }: { place: string }) {
  const country = place.split(', ').pop() ?? '';
  return (
    <span className="tr-place">
      <Flagged code={placeFlags[country] ?? null}>{place}</Flagged>
    </span>
  );
}
