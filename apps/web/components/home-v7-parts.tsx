'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DotMap, type SpotKey, type Tone } from './home-v44-dotmap';
import { useHomeV44Motion } from './home-v44-motion';
import { useT } from './language-provider';
import { StartBar } from './ux/start-bar';
import { v43 } from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';
import type { Shown } from './home-routes';

// Home page v7 bands, written exactly as the owner's canvas board "Home v7" (27 Nov 2026): the words, order and sizes
// of the board, in English. Every band has its own classes (hv7-*) and its own stylesheet. Nothing here sends anything.
const Eb = ({ children }: { children: ReactNode }) => <p className="hv7-eb">{children}</p>;

const Check = () => <i aria-hidden="true">✓</i>;

export function Hero() {
  const t = useT();
  useHomeV44Motion();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (paused) root.setAttribute('data-hv7-paused', '');
    else root.removeAttribute('data-hv7-paused');
    return () => root.removeAttribute('data-hv7-paused');
  }, [paused]);
  return (
    <section className="hv7-hero" id="hero" aria-labelledby="home-title">
      <div className="hv7-hero-map" aria-hidden="true">
        <DotMap
          view="60 10 640 250"
          routes={['EU', 'US', 'AU', 'CN', 'AE']}
          labels={{ EU: {}, US: {}, AU: {}, CN: {}, AE: {}, BD: {} }}
        />
      </div>
      <div className="hv7-hero-text">
        <Eb>For Bangladeshi business</Eb>
        <h1 id="home-title">
          Find the right <span className="hv7-outline">business</span>
          <br />
          partners.
        </h1>
        <p className="hv7-lead">
          Source from China, meet buyers abroad, or organise a business delegation. Corridra checks
          who fits, sets up meetings, and follows through.
        </p>
        <div className="hv7-actions">
          <a className="hv7-btn" href="#brief" id="home-start" data-start-action>
            Start a request
          </a>
          <a className="hv7-link" href="#example">
            See a worked example ↓
          </a>
        </div>
      </div>
      <button
        type="button"
        className="hv7-pause"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
      >
        {t(paused ? 'home.v44.motion.play' : 'home.v44.motion.pause')}
      </button>
    </section>
  );
}

type Door = {
  route: RouteKey;
  tab: string;
  title: string;
  ticks: readonly string[];
  view: string;
  routes: SpotKey[];
  labels: Partial<
    Record<SpotKey, { name?: string; y?: number; dx?: number; anchor?: 'start' | 'middle' | 'end' }>
  >;
  /** Goods and people come towards Bangladesh: arcs and travelling dots run from the place to it. */
  inbound?: boolean;
};
const doors: readonly Door[] = [
  {
    route: 'china',
    tab: 'Buy from China',
    title: 'Buy from China, from checked suppliers.',
    ticks: ['Suppliers checked first', 'Meetings set up for you', 'Follow-through after'],
    view: '330 10 380 250',
    routes: ['CN', 'SG'],
    labels: { CN: {}, SG: {}, BD: {} },
    inbound: true,
  },
  {
    route: 'sell',
    tab: 'Sell abroad',
    title: 'Sell abroad, to buyers who fit.',
    ticks: [
      'Buyers matched to your product',
      'Introductions, not cold calls',
      'Follow-through after',
    ],
    view: '90 0 620 250',
    routes: ['EU', 'UK', 'US'],
    labels: { EU: {}, UK: {}, US: {}, BD: {} },
  },
  {
    route: 'delegation',
    tab: 'Business delegation',
    title: 'Take a business delegation.',
    ticks: [
      'Companies chosen for your goal',
      'Meetings booked in order',
      'A single plan to follow',
    ],
    view: '330 10 380 250',
    routes: ['CN', 'AU', 'AE'],
    labels: { CN: {}, AU: {}, AE: {}, BD: { y: 138, dx: 0, anchor: 'middle' } },
  },
  {
    route: 'other',
    tab: 'Something else',
    title: 'Something else? Tell us.',
    ticks: ['Describe it in your own words', 'We reply with the right route'],
    view: '400 30 280 200',
    routes: [],
    labels: { BD: {} },
  },
];

export function Choose({
  intent,
  onChoose,
}: {
  intent: RouteKey;
  onChoose: (route: RouteKey) => void;
}) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + doors.length) % doors.length;
    onChoose(doors[next]!.route);
    tabs.current[next]?.focus();
  };
  const door = doors.find((d) => d.route === intent) ?? doors[0]!;
  return (
    <section className="hv7-band hv7-band-choose" id="start" aria-labelledby="hv7-question">
      <h2 className="hv7-eb" id="hv7-question">
        What do you want to do?
      </h2>
      <div className="hv7-card hv7-choose" id="pick">
        <div id="home-route-group" tabIndex={-1} className="hv7-seg-wrap">
          <div className="hv7-seg" role="tablist" aria-label="What do you want to do?">
            {doors.map((d, index) => (
              <button
                key={d.route}
                type="button"
                role="tab"
                id={`hv7-tab-${d.route}`}
                aria-selected={door.route === d.route}
                aria-controls="hv7-panel"
                tabIndex={door.route === d.route ? 0 : -1}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                onClick={() => onChoose(d.route)}
                onKeyDown={(event) => move(event, index)}
              >
                {d.tab}
              </button>
            ))}
          </div>
        </div>
        <div
          className="hv7-panel"
          id="hv7-panel"
          key={door.route}
          role="tabpanel"
          aria-labelledby={`hv7-tab-${door.route}`}
        >
          <div className="hv7-panel-text">
            <p className="hv7-panel-title">{door.title}</p>
            <ul className="hv7-ticks">
              {door.ticks.map((tick) => (
                <li key={tick}>
                  <Check />
                  {tick}
                </li>
              ))}
            </ul>
          </div>
          <div className="hv7-panel-map" aria-hidden="true">
            <DotMap
              view={door.view}
              routes={door.routes}
              labels={door.labels}
              inbound={door.inbound}
              flags
            />
          </div>
        </div>
      </div>
    </section>
  );
}

const steps = [
  ['Tell us what you need', 'Goal and market, in four short steps.'],
  ['We check who fits', 'Sources shown with every result.'],
  ['Meetings, then follow-through', 'Booked, tracked, and reported.'],
] as const;

// What each step shows on the map (canvas board "Home v9"). The three suppliers and the two meetings are the worked
// example's invented numbers, not data.
const candidates = [
  [546, 72],
  [592, 74],
  [602, 96],
] as const;
const tag = (x: number, y: number, width: number, text: string, tone: 'plain' | 'gold') => (
  <g key={text} className="hv7-tag" data-tone={tone}>
    <rect x={x} y={y} width={width} height={18} rx={9} />
    <text x={x + width / 2} y={y + 12.5} textAnchor="middle">
      {text}
    </text>
  </g>
);

function ProcessMap({ step }: { step: number }) {
  const view = '390 20 330 200';
  if (step === 1)
    return <DotMap key={1} view={view} flags labels={{ BD: { name: 'Your request' } }} />;
  if (step === 2)
    return (
      <DotMap
        key={2}
        view={view}
        flags
        routes={['CN']}
        labels={{ CN: {}, BD: {} }}
        extra={
          <>
            {candidates.map(([x, y]) => (
              <circle key={`${x}-${y}`} className="hv7-cand" cx={x} cy={y} r={3.4} />
            ))}
            {tag(507, 146, 136, '3 suppliers, sources shown', 'plain')}
          </>
        }
      />
    );
  return (
    <DotMap
      key={3}
      view={view}
      flags
      routes={['GZ']}
      labels={{ GZ: {}, BD: {} }}
      extra={tag(604, 105, 68, '2 meetings', 'gold')}
    />
  );
}

export function Process() {
  const [step, setStep] = useState(1);
  return (
    <section className="hv7-band" id="process" aria-labelledby="process-title">
      <Eb>How it works</Eb>
      <h2 className="hv7-h2" id="process-title">
        Three steps. One thread.
      </h2>
      <div className="hv7-process">
        <ol className="hv7-steps-list">
          {steps.map(([title, line], index) => (
            <li key={title}>
              <button
                type="button"
                className="hv7-step"
                aria-pressed={step === index + 1}
                onClick={() => setStep(index + 1)}
              >
                <span className="hv7-no">{index + 1}</span>
                <span>
                  <b>{title}</b>
                  <span>{line}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="hv7-process-map" aria-hidden="true">
          <ProcessMap step={step} />
        </div>
      </div>
      <p className="hv7-caption hv7-caption-l">
        Pick a step and the map shows what happens on it. Example: a shirt maker in Dhaka buying
        cotton fabric from China (invented).
      </p>
    </section>
  );
}

const statusRows: ReadonlyArray<readonly [string, string, Tone]> = [
  ['Bangladesh to China', 'Open', 'open'],
  ['Bangladesh to UAE', 'Preparing', 'soon'],
  ['Bangladesh to Singapore', 'Preparing', 'soon'],
  ['Bangladesh to EU', 'By request', 'ask'],
];

export function Status() {
  return (
    <section className="hv7-band" id="routes" aria-labelledby="hv7-status-title">
      <div className="hv7-status">
        <div className="hv7-status-map" aria-hidden="true">
          <DotMap
            view="280 10 420 250"
            routes={['CN']}
            pins={['AE', 'EU', 'SG']}
            tones={{ CN: 'open', AE: 'soon', SG: 'soon', EU: 'ask' }}
            labels={{ CN: {}, AE: { y: 98 }, EU: { name: 'EU' }, SG: {}, BD: {} }}
          />
        </div>
        <div>
          <Eb>Route statuses</Eb>
          <h2 className="hv7-h2 hv7-h2-s" id="hv7-status-title">
            Where each route stands today.
          </h2>
          <ul className="hv7-list hv7-card">
            {statusRows.map(([name, status, tone]) => (
              <li key={name}>
                <Link prefetch={false} href="/corridors">
                  <i className="hv7-dot" data-tone={tone} aria-hidden="true" />
                  <b>{name}</b>
                  <span>{status}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Trust() {
  return (
    <section className="hv7-band" id="trust" aria-labelledby="trust-title">
      <div className="hv7-card hv7-trust">
        <div>
          <Eb>Evidence</Eb>
          <h2 className="hv7-h2" id="trust-title">
            What is checked, and what is not claimed.
          </h2>
        </div>
        <ul className="hv7-ticks hv7-ticks-l">
          {[
            'Sources are shown with every result',
            'Money and history are exact',
            'Nothing is sent until reviewed',
          ].map((line) => (
            <li key={line}>
              <Check />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const story = [
  ['you', 'You', 'Day 1', 'Send the request', 'Cotton fabric, Guangzhou, within a month.'],
  [
    'team',
    'Corridra',
    'Day 2',
    'Checks who fits',
    'Three suppliers shortlisted, each with its sources.',
  ],
  ['you', 'You', 'Day 4', 'Choose and approve', 'You pick two. Nothing is sent before you say so.'],
  [
    'team',
    'Corridra',
    'Week 2',
    'Meetings booked',
    'Two meetings in Guangzhou, with a plan to follow.',
  ],
] as const;

export function Example() {
  return (
    <section className="hv7-band" id="example" aria-labelledby="example-title">
      <Eb>Worked example, invented names</Eb>
      <h2 className="hv7-h2" id="example-title" tabIndex={-1}>
        One request, start to meeting.
      </h2>
      <p className="hv7-sub">
        Mina Textiles, a shirt maker in Dhaka, needs cotton fabric from China. Here is what happens,
        and who does what.
      </p>
      <ol className="hv7-cards">
        {story.map(([who, label, when, title, line]) => (
          <li key={when} className="hv7-card">
            <div className="hv7-card-top">
              <b data-who={who}>{label}</b>
              <span>{when}</span>
            </div>
            <strong>{title}</strong>
            <span>{line}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Inbound({ onInbound }: { onInbound: () => void }) {
  return (
    <section className="hv7-band" id="inbound" aria-labelledby="inbound-title">
      <div className="hv7-inbound">
        <div>
          <Eb>Coming to Bangladesh</Eb>
          <h2 className="hv7-h2 hv7-h2-s hv7-h2-m" id="inbound-title">
            Inbound buyers and delegations.
          </h2>
          <p className="hv7-inbound-text">
            Companies from abroad who want to meet Bangladeshi partners. Same checks, same
            follow-through.
          </p>
          <button type="button" className="hv7-link hv7-link-b" onClick={onInbound}>
            Read about inbound →
          </button>
        </div>
        <div className="hv7-inbound-map" aria-hidden="true">
          <DotMap view="280 10 420 250" routes={['EU']} inbound />
        </div>
      </div>
    </section>
  );
}

const faq = [
  [
    'Do I need an account?',
    'No. Start a request first. An account comes later, only if you want one.',
  ],
  ['What does it cost?', 'faq.3.a'],
  ['Who sees my request?', 'faq.6.a'],
  ['What happens after I send it?', 'faq.8.a'],
] as const;

export function Faq() {
  const t = useT();
  return (
    <section className="hv7-band" id="questions" aria-labelledby="questions-title">
      <div className="hv7-faq">
        <div>
          <Eb>Questions</Eb>
          <h2 className="hv7-h2" id="questions-title">
            Asked often.
          </h2>
        </div>
        <div className="hv7-card hv7-faq-list">
          {faq.map(([q, a], index) => (
            <details key={q} open={index === 0}>
              <summary>{q}</summary>
              <p>{a.startsWith('faq.') ? t(v43(a)) : a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const hideStartBarAt = ['main [data-start-action]', '#final', 'footer'];

export function Closing({ shown, href, cta }: { shown: Shown; href: string; cta: string }) {
  const t = useT();
  return (
    <>
      <section className="hv7-band hv7-band-close" aria-labelledby="final-title">
        <div className="hv7-closing" id="final">
          <div className="hv7-closing-text">
            <Eb>Your move</Eb>
            <h2 id="final-title">
              The next <span className="hv7-outline">partner</span>
              <br />
              is one request away.
            </h2>
            <div>
              <a className="hv7-btn" href="#brief" id="final-start" data-start-action>
                Start a request
              </a>
              <p className="hv7-closing-note">
                Takes about two minutes. Nothing is sent until reviewed.
              </p>
            </div>
          </div>
          <div className="hv7-closing-map" aria-hidden="true">
            <DotMap view="330 20 340 200" routes={['CN']} fill />
          </div>
        </div>
      </section>
      <StartBar
        href={href}
        label={cta}
        note={t('home.b3.mbar.note')}
        name={t('home.b3.mbar')}
        after="hero"
        hideAt={hideStartBarAt}
        watchKey={shown}
      />
    </>
  );
}
