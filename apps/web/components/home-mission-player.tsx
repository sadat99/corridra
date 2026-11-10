'use client';

import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { CorridraIcon } from './corridra-icon';
import { FactLabel, type factLabels } from './fact-label';
import { useT } from './language-provider';
import { useLessMovement } from './ux/use-comfort';
import { fill } from '../lib/i18n/fill';
import type { MessageKey } from '../lib/i18n/messages';

type Fact = (typeof factLabels)[number]['label'];
/** A value is a message key, or text that is the same in every language (an amount or a delivery code). */
type Value = { key: MessageKey } | { text: string };
type Tone = 'num' | 'ok' | 'miss' | 'bad';
type Quote = readonly [Value, Tone, Fact?];

type Example = {
  id: string;
  tab: MessageKey;
  title: MessageKey;
  note: MessageKey;
  notReal: MessageKey;
  request: {
    headline: MessageKey;
    job: MessageKey;
    to: MessageKey;
    product: MessageKey;
    timing: MessageKey;
    meta: MessageKey;
  };
  find: {
    title: MessageKey;
    aria: MessageKey;
    companies: readonly (readonly [MessageKey, MessageKey, Fact])[];
  };
  compare: {
    title: MessageKey;
    aria: MessageKey;
    columns: readonly MessageKey[];
    rows: readonly { term: MessageKey; values: readonly Quote[] }[];
    note?: MessageKey;
  };
  visit: readonly (readonly [MessageKey, MessageKey, MessageKey])[];
  decide: {
    name: MessageKey;
    why: MessageKey;
    evidence: readonly (readonly [MessageKey, Fact])[];
  };
  follow: readonly (readonly [MessageKey, MessageKey])[];
};

/** The customer road (D5): the same six names the request, the account and How it works use. */
const steps = [
  ['home.step.define.title', 'home.step.define.text'],
  ['home.step.find.title', 'home.step.find.text'],
  ['home.step.compare.title', 'home.step.compare.text'],
  ['home.step.visit.title', 'home.step.visit.text'],
  ['home.step.decide.title', 'home.step.decide.text'],
  ['home.step.follow.title', 'home.step.follow.text'],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const notStated: Value = { key: 'home.value.notStated' };
const notConfirmed: Value = { key: 'home.value.notConfirmed' };

/**
 * The two example missions, one screen per step. Sample data only: no real company, no stored record, no count
 * presented as a result. The words are keys in the message files; the five trust names stay English everywhere.
 */
const examples: readonly Example[] = [
  {
    id: 'sell',
    tab: 'home.ex.sell.tab',
    title: 'home.ex.sell.title',
    note: 'home.player.sell.note',
    notReal: 'home.exhibit.companies',
    request: {
      headline: 'home.player.sell.request',
      job: 'home.start.sell.title',
      to: 'home.country.es',
      product: 'home.player.sell.product',
      timing: 'home.player.sell.timing',
      meta: 'home.ex.sell.meta',
    },
    find: {
      title: 'home.buyers.title',
      aria: 'home.buyers.aria',
      companies: [
        ['home.buyer.a.name', 'home.buyer.a.note', 'Evidence available'],
        ['home.buyer.b.name', 'home.ex.sell.b.note', 'Self-declared'],
        ['home.buyer.c.name', 'home.buyer.c.note', 'Verified'],
        ['home.buyer.d.name', 'home.buyer.d.note', 'Self-declared'],
      ],
    },
    compare: {
      title: 'home.player.sell.compare.title',
      aria: 'home.player.sell.compare.aria',
      columns: ['home.player.sell.col.a', 'home.player.sell.col.b', 'home.player.sell.col.c'],
      rows: [
        {
          term: 'home.player.term.target',
          values: [
            [{ text: 'EUR 6.20' }, 'num', 'Evidence available'],
            [{ text: 'EUR 5.80' }, 'num'],
            [notStated, 'miss'],
          ],
        },
        {
          term: 'home.term.delivery',
          values: [
            [{ text: 'FOB Chattogram' }, 'num'],
            [{ text: 'DDP Valencia' }, 'num', 'Self-declared'],
            [{ text: 'CIF Barcelona' }, 'num'],
          ],
        },
        {
          term: 'home.player.term.order',
          values: [
            [{ key: 'home.player.value.pieces3000' }, 'num'],
            [notStated, 'miss'],
            [{ key: 'home.player.value.pieces1200' }, 'num', 'Evidence available'],
          ],
        },
        {
          term: 'home.player.term.payment',
          values: [
            [{ key: 'home.player.value.credit' }, 'ok', 'Verified'],
            [{ key: 'home.player.value.days60' }, 'bad'],
            [notConfirmed, 'miss'],
          ],
        },
      ],
    },
    visit: [
      ['home.player.day.one', 'home.buyer.a.name', 'home.buyer.a.state'],
      ['home.player.day.two', 'home.buyer.c.name', 'home.buyer.c.state'],
      ['home.player.day.three', 'home.buyer.b.name', 'home.buyer.b.state'],
    ],
    decide: {
      name: 'home.buyer.a.name',
      why: 'home.buyer.a.note',
      evidence: [
        ['home.dossier.priceList', 'Evidence available'],
        ['home.dossier.registration', 'Verified'],
        ['home.dossier.volume', 'Self-declared'],
      ],
    },
    follow: [
      ['home.player.sell.follow.a', 'home.player.state.now'],
      ['home.player.sell.follow.b', 'home.player.state.next'],
      ['home.player.sell.follow.c', 'home.player.state.later'],
    ],
  },
  {
    id: 'buy',
    tab: 'home.ex.buy.tab',
    title: 'home.ex.buy.title',
    note: 'home.player.buy.note',
    notReal: 'home.exhibit.suppliers',
    request: {
      headline: 'home.player.buy.request',
      job: 'home.start.buy.title',
      to: 'home.country.cn',
      product: 'home.player.buy.product',
      timing: 'home.player.buy.timing',
      meta: 'home.ex.buy.meta',
    },
    find: {
      title: 'home.player.buy.find.title',
      aria: 'home.player.buy.find.aria',
      companies: [
        ['home.ex.buy.a.name', 'home.ex.buy.a.note', 'Evidence available'],
        ['home.ex.buy.b.name', 'home.ex.buy.b.note', 'Self-declared'],
        ['home.ex.buy.c.name', 'home.ex.buy.c.note', 'Verified'],
        ['home.ex.buy.d.name', 'home.ex.buy.d.note', 'Self-declared'],
      ],
    },
    compare: {
      title: 'home.quotes.title',
      aria: 'home.quotes.aria',
      columns: ['home.supplier.a', 'home.supplier.b', 'home.supplier.c'],
      rows: [
        {
          term: 'home.term.price',
          values: [
            [{ text: 'USD 42,000' }, 'num', 'Evidence available'],
            [{ text: 'USD 38,500' }, 'num'],
            [{ text: 'USD 45,700' }, 'num'],
          ],
        },
        {
          term: 'home.term.delivery',
          values: [
            [{ text: 'FOB Ningbo' }, 'num'],
            [notStated, 'miss'],
            [{ text: 'CIF Chattogram' }, 'num', 'Self-declared'],
          ],
        },
        {
          term: 'home.term.install',
          values: [
            [{ key: 'home.value.included' }, 'ok', 'Verified'],
            [{ key: 'home.value.notIncluded' }, 'bad'],
            [notConfirmed, 'miss'],
          ],
        },
        {
          term: 'home.term.lead',
          values: [
            [{ key: 'home.value.days90' }, 'num'],
            [{ key: 'home.value.days75' }, 'num', 'Evidence available'],
            [{ key: 'home.value.days120' }, 'num'],
          ],
        },
      ],
      note: 'home.term.delivery.note',
    },
    visit: [
      ['home.player.day.one', 'home.ex.buy.a.name', 'home.player.buy.visit.a'],
      ['home.player.day.two', 'home.ex.buy.c.name', 'home.player.buy.visit.c'],
      ['home.player.day.three', 'home.ex.buy.b.name', 'home.player.buy.visit.b'],
    ],
    decide: {
      name: 'home.ex.buy.a.name',
      why: 'home.ex.buy.a.note',
      evidence: [
        ['home.term.price', 'Evidence available'],
        ['home.term.install', 'Verified'],
        ['home.term.lead', 'Self-declared'],
      ],
    },
    follow: [
      ['home.player.buy.follow.a', 'home.player.state.now'],
      ['home.player.buy.follow.b', 'home.player.state.next'],
      ['home.player.buy.follow.c', 'home.player.state.later'],
    ],
  },
];

/** Owner decision, 6 November 2026: the player moves on every 4 seconds until it is paused. */
const advanceEvery = 4000;

// Motion follows the visitor's setting (the system's, or Less Movement in the menus): with reduced motion the
// player never moves on by itself.
const reducedMotion = '(prefers-reduced-motion: reduce)';
const subscribeToMotion = (onChange: () => void) => {
  const query = window.matchMedia(reducedMotion);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const prefersReducedMotion = () => window.matchMedia(reducedMotion).matches;
const motionUnknownOnServer = () => false;

function ValueText({ value }: { value: Value }) {
  const t = useT();
  if ('key' in value) return <>{t(value.key)}</>;
  // An amount or a delivery code is written the same in every language.
  return (
    <span lang="en" dir="ltr">
      {value.text}
    </span>
  );
}

function ScreenHead({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="ac1-screen-head">
      <h3>{title}</h3>
      {aside ? <p>{aside}</p> : null}
    </div>
  );
}

/** One screen of sample data for one step of one example. */
function Screen({ example, step }: { example: Example; step: number }) {
  const t = useT();
  switch (step) {
    case 0:
      return (
        <>
          <ScreenHead title={t('home.player.request')} />
          <div className="ac1-screen-body">
            <p className="ac1-request">{t(example.request.headline)}</p>
            <dl className="ac1-fields">
              <div>
                <dt>{t('home.player.field.objective')}</dt>
                <dd>{t(example.request.job)}</dd>
              </div>
              <div>
                <dt>{t('home.player.field.route')}</dt>
                <dd>
                  {t('home.country.bd')}{' '}
                  <CorridraIcon name="arrow" size={16} className="ac1-route-arrow" />{' '}
                  {t(example.request.to)}
                </dd>
              </div>
              <div>
                <dt>{t('home.player.field.product')}</dt>
                <dd>{t(example.request.product)}</dd>
              </div>
              <div>
                <dt>{t('home.player.field.timing')}</dt>
                <dd>{t(example.request.timing)}</dd>
              </div>
            </dl>
            <p className="ac1-screen-note">{t(example.request.meta)}</p>
          </div>
        </>
      );
    case 1:
      return (
        <>
          <ScreenHead title={t(example.find.title)} aside={t(example.notReal)} />
          <ul className="ac1-buyers" aria-label={t(example.find.aria)}>
            {example.find.companies.map(([name, note, fact]) => (
              <li key={name}>
                <strong>{t(name)}</strong>
                <span>{t(note)}</span>
                <FactLabel label={fact} english />
              </li>
            ))}
          </ul>
        </>
      );
    case 2:
      return (
        <>
          <ScreenHead title={t(example.compare.title)} aside={t('home.player.missing')} />
          <div className="ac1-compare" role="table" aria-label={t(example.compare.aria)}>
            <div className="ac1-compare-row ac1-compare-head" role="row">
              <span role="columnheader">{t('home.quotes.term')}</span>
              {example.compare.columns.map((column) => (
                <span role="columnheader" key={column}>
                  {t(column)}
                </span>
              ))}
            </div>
            {example.compare.rows.map((row) => (
              <div className="ac1-compare-row" role="row" key={row.term}>
                <span role="rowheader">{t(row.term)}</span>
                {row.values.map(([value, tone, fact], index) => (
                  <span
                    role="cell"
                    key={example.compare.columns[index]}
                    data-tone={tone}
                    data-column={t(example.compare.columns[index])}
                  >
                    <ValueText value={value} />
                    {fact ? <FactLabel label={fact} english /> : null}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {example.compare.note ? (
            <p className="ac1-screen-note">{t(example.compare.note)}</p>
          ) : null}
        </>
      );
    case 3:
      return (
        <>
          <ScreenHead title={t('home.player.visit.title')} aside={t(example.notReal)} />
          <ol className="ac1-plan" aria-label={t('home.player.visit.aria')}>
            {example.visit.map(([day, company, plan]) => (
              <li key={company}>
                <span className="label">{t(day)}</span>
                <strong>{t(company)}</strong>
                <span>{t(plan)}</span>
              </li>
            ))}
          </ol>
        </>
      );
    case 4:
      return (
        <>
          <ScreenHead title={t('home.player.decide.title')} aside={t(example.notReal)} />
          <div className="ac1-screen-body">
            <p className="ac1-request">{t(example.decide.name)}</p>
            <p className="ac1-screen-note">{t(example.decide.why)}</p>
            <ul className="ac1-evidence">
              {example.decide.evidence.map(([field, fact]) => (
                <li key={field}>
                  <span>{t(field)}</span>
                  <FactLabel label={fact} english />
                </li>
              ))}
            </ul>
          </div>
        </>
      );
    default:
      return (
        <>
          <ScreenHead title={t('home.player.follow.title')} />
          <ol className="ac1-plan" aria-label={t('home.player.follow.aria')}>
            {example.follow.map(([task, state]) => (
              <li key={task}>
                <strong>{t(task)}</strong>
                <span className="label">{t(state)}</span>
              </li>
            ))}
          </ol>
        </>
      );
  }
}

/**
 * The Mission Player on the home page (concept G, owner decision of 6 November 2026): one example request moving
 * through the six steps, for selling or for sourcing. It moves on every 4 seconds with a visible Pause (WCAG
 * 2.2.2), holds while the pointer is over it, stops for good once keyboard focus enters or a control is used,
 * and never moves on by itself under reduced motion. A step change is announced only when the visitor makes it.
 */
export function HomeMissionPlayer() {
  const t = useT();
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const systemReduced = useSyncExternalStore(
    subscribeToMotion,
    prefersReducedMotion,
    motionUnknownOnServer,
  );
  // Less Movement in the menus adds to the system setting and never undoes it.
  const [lessMovement] = useLessMovement();
  const reduced = systemReduced || lessMovement === 'on';
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const running = playing && !hovered && !reduced;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () => setStep((current) => (current + 1) % steps.length),
      advanceEvery,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  const stepLabel = (index: number) =>
    fill(t('home.player.step'), {
      step: index + 1,
      total: steps.length,
      name: t(steps[index][0]),
    });

  function go(direction: 1 | -1) {
    const next = (step + direction + steps.length) % steps.length;
    setPlaying(false);
    setStep(next);
    setAnnouncement(stepLabel(next));
  }

  function choose(index: number) {
    setPlaying(false);
    setActive(index);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = examples.length - 1;
    // Where the text reads right to left the tabs are laid out right to left, so the arrow keys swap.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    const target =
      event.key === forward
        ? active === last
          ? 0
          : active + 1
        : event.key === back
          ? active === 0
            ? last
            : active - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    choose(target);
    tabs.current[target]?.focus();
  }

  // Keyboard focus inside the player stops it until the visitor presses Play (a pointer press does not).
  function onFocus(event: FocusEvent<HTMLElement>) {
    if (event.target.matches(':focus-visible')) setPlaying(false);
  }

  function togglePlay() {
    setHovered(false);
    setPlaying(!playing);
  }

  const example = examples[active];
  return (
    <article
      className="ac1-record ac1-player"
      aria-label={t('home.ex.aria')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={onFocus}
    >
      <div className="ac1-record-head">
        {reduced ? null : (
          <button type="button" className="ac1-play" onClick={togglePlay}>
            <CorridraIcon name={playing ? 'pause' : 'play'} />
            <span className="sr-only">{t(playing ? 'home.player.pause' : 'home.player.play')}</span>
          </button>
        )}
        <div className="ac1-record-tabs" role="tablist" aria-label={t('home.ex.tabs.aria')}>
          {examples.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`home-example-tab-${item.id}`}
              aria-controls="home-example-panel"
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              onClick={() => choose(index)}
              onKeyDown={onKeyDown}
            >
              {t(item.tab)}
            </button>
          ))}
        </div>
        <span className="ac1-example-tag">{t('home.example')}</span>
      </div>
      <div
        className="ac1-record-body"
        role="tabpanel"
        id="home-example-panel"
        aria-labelledby={`home-example-tab-${example.id}`}
      >
        <div className="ac1-player-title">
          <h2>{t(example.title)}</h2>
          <p>{t(example.note)}</p>
        </div>
        <ol className="ac1-steps" aria-label={t('home.steps.aria')}>
          {steps.map(([title, text], index) => (
            <li
              key={title}
              className={index < step ? 'is-done' : index === step ? 'is-now' : undefined}
              aria-current={index === step ? 'step' : undefined}
            >
              <span className="ac1-step-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="ac1-step-bar" aria-hidden="true" />
              <span className="ac1-step-name">{t(title)}</span>
              <span className="sr-only">{t(text)}</span>
            </li>
          ))}
        </ol>
        <div className="ac1-screens">
          {steps.map(([title], index) => (
            <div
              key={`${example.id}-${title}`}
              className="ac1-screen"
              data-current={index === step ? 'true' : undefined}
            >
              <Screen example={example} step={index} />
            </div>
          ))}
        </div>
        <div className="ac1-player-caption">
          <p>
            <strong>{stepLabel(step)}</strong> {t(steps[step][1])}{' '}
            <Link prefetch={false} href="/how-it-works">
              {t('home.steps.more')}
            </Link>
          </p>
          <div className="ac1-player-controls">
            <button type="button" className="ac1-player-back" onClick={() => go(-1)}>
              <CorridraIcon name="chevron" />
              <span className="sr-only">{t('home.player.previous')}</span>
            </button>
            <button type="button" onClick={() => go(1)}>
              <CorridraIcon name="chevron" />
              <span className="sr-only">{t('home.player.next')}</span>
            </button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </div>
    </article>
  );
}
