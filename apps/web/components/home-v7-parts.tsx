'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CorridraIcon } from './corridra-icon';
import { DotMap, type SpotKey } from './home-v44-dotmap';
import { useHomeV44Motion } from './home-v44-motion';
import { PlaceWords } from './place-words';
import { Sentence } from './home-v42-choice';
import { useT } from './language-provider';
import { StartBar } from './ux/start-bar';
import { faqIds, placeName, v43 } from '../lib/home-v43-data';
import { sentences } from '../lib/how-trust-v43';
import type { RouteKey } from '../lib/home-routes-data';
import type { MessageKey } from '../lib/i18n/messages';
import type { Shown } from './home-routes';

// Home page v7 bands (design approved 27 Nov 2026, canvas "v7"): every band is built here with its own classes (hv7-*)
// and its own stylesheet. The words are the site's existing words; only the worked example and the close carry new
// ones (lib/i18n/home-v43-words-more.ts). Nothing here sends anything.
const Eb = ({ children }: { children: ReactNode }) => <p className="hv7-eb">{children}</p>;
const four = [1, 2, 3, 4] as const;

export function Hero() {
  const t = useT();
  useHomeV44Motion();
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (paused) root.setAttribute('data-hv44-paused', '');
    else root.removeAttribute('data-hv44-paused');
    return () => root.removeAttribute('data-hv44-paused');
  }, [paused]);
  const [first = '', ...rest] = t(v43('hero.title.b')).split(' ');
  return (
    <section className="hv7-hero" id="hero" aria-labelledby="home-title">
      <div className="hv7-hero-map" aria-hidden="true">
        <DotMap
          view="120 10 560 230"
          routes={['EU', 'US', 'AU', 'CN', 'AE']}
          pins={['EU', 'US', 'AU', 'CN', 'AE']}
        />
      </div>
      <div className="hv7-hero-text">
        <Eb>{t('home.eyebrow')}</Eb>
        <h1 id="home-title">
          {t(v43('hero.title.a'))}{' '}
          <em>
            <span className="hv7-outline">{first}</span>
            {rest.length ? ` ${rest.join(' ')}` : ''}
          </em>
        </h1>
        <p className="hv7-lead">
          <PlaceWords text={t(v43('hero.lead'))} />
        </p>
        <div className="hv7-actions">
          <a className="hv7-btn" href="#brief" id="home-start" data-start-action>
            {t(v43('hero.start'))}
          </a>
          <a className="hv7-link" href="#example">
            {t(v43('hero.example'))}
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

const routes = ['china', 'sell', 'delegation', 'other'] as const;
const sol = { china: 'source', sell: 'sell', delegation: 'delegation' } as const;
const mapFor: Record<RouteKey, { view: string; routes: SpotKey[] }> = {
  china: { view: '430 40 230 130', routes: ['CN', 'SG'] },
  sell: { view: '120 20 560 190', routes: ['EU', 'UK', 'US'] },
  delegation: { view: '380 40 300 200', routes: ['CN', 'AU', 'AE'] },
  other: { view: '470 70 150 90', routes: [] },
};

export function Choose({
  intent,
  onChoose,
}: {
  intent: RouteKey;
  onChoose: (route: RouteKey) => void;
}) {
  const t = useT();
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + routes.length) % routes.length;
    onChoose(routes[next]!);
    tabs.current[next]?.focus();
  };
  const solution = intent === 'other' ? null : sol[intent];
  return (
    <section className="hv7-band" id="start" aria-labelledby="hv7-question">
      <h2 className="hv7-eb" id="hv7-question">
        {t('home.tr.q')}
      </h2>
      <div className="hv7-card hv7-choose" id="pick">
        <div id="home-route-group" tabIndex={-1} className="hv7-seg-wrap">
          <div className="hv7-seg" role="tablist" aria-label={t('home.tr.q')}>
            {routes.map((route, index) => (
              <button
                key={route}
                type="button"
                role="tab"
                id={`hv7-tab-${route}`}
                aria-selected={intent === route}
                aria-controls="hv7-panel"
                tabIndex={intent === route ? 0 : -1}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                onClick={() => onChoose(route)}
                onKeyDown={(event) => move(event, index)}
              >
                <PlaceWords text={t(v43(`door.${route}.title`))} />
              </button>
            ))}
          </div>
        </div>
        <div className="hv7-panel" id="hv7-panel" key={intent} role="tabpanel" aria-labelledby={`hv7-tab-${intent}`}>
          <div className="hv7-panel-text">
            <p className="hv7-small">
              {intent === 'china' || intent === 'sell' ? (
                <Sentence route={intent} />
              ) : (
                <PlaceWords text={t(v43(`door.${intent}.line`))} />
              )}
            </p>
            <p className="hv7-panel-lead">
              <PlaceWords
                text={t(v43(solution ? `sol.${solution}.text` : 'door.other.line'))}
              />
            </p>
            {solution ? (
              <p className="hv7-small">
                <strong>{t(v43('sol.get'))}</strong> {t(v43(`sol.${solution}.get`))}
              </p>
            ) : null}
            <ul className="hv7-ticks">
              {(['account', 'send', 'stop'] as const).map((name) => (
                <li key={name}>
                  <i aria-hidden="true">
                    <CorridraIcon name="check" size={14} />
                  </i>
                  {t(`home.tr.assure.${name}` as MessageKey)}
                </li>
              ))}
            </ul>
          </div>
          <div className="hv7-panel-map" aria-hidden="true">
            <DotMap
              view={mapFor[intent].view}
              routes={mapFor[intent].routes}
              pins={mapFor[intent].routes}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

export function Process() {
  const t = useT();
  return (
    <section className="hv7-band" id="process" aria-labelledby="process-title">
      <Eb>{t(v43('process.eyebrow'))}</Eb>
      <h2 className="hv7-h2" id="process-title">
        {t(v43('process.title'))}
      </h2>
      <ol className="hv7-timeline">
        {four.map((n) => (
          <li key={n}>
            <span className="hv7-no">{n}</span>
            <strong>{t(`home.v43.process.step.${n}` as MessageKey)}</strong>
            <span>{t(`home.v43.process.rec.china.${n}.line` as MessageKey)}</span>
          </li>
        ))}
      </ol>
      <Link prefetch={false} className="hv7-link" href="/how-it-works">
        {t(v43('process.full'))}
      </Link>
    </section>
  );
}

export function Status() {
  const t = useT();
  const all = [placeName.EU, placeName.GB, placeName.US, placeName.AU]
    .map((key) => t(key))
    .join(', ');
  const rows: Array<[string, string, string]> = [
    [`${t(placeName.BD)} → ${t(placeName.CN)}`, t('home.tr.rs.open'), 'open'],
    [`${t(placeName.BD)} → ${all}`, t('home.tr.rs.open'), 'open'],
    [t('home.tr.rs.rev'), t('home.tr.rs.selective'), 'soon'],
    [t('home.tr.rs.other'), t('home.tr.rs.ask'), 'ask'],
  ];
  const steps = [1, 2, 3, 4, 5, 6]
    .map((n) => t(`home.tr.rs.ready.${n}` as 'home.tr.rs.ready.1'))
    .join(' · ');
  return (
    <section className="hv7-band" id="routes" aria-labelledby="hv7-status-title">
      <div className="hv7-status">
        <div className="hv7-status-map" aria-hidden="true">
          <DotMap
            view="300 20 380 220"
            routes={['CN', 'EU', 'US', 'AU']}
            pins={['CN', 'EU', 'US', 'AU', 'AE', 'SG']}
            tones={{ AE: 'ask', SG: 'ask' }}
          />
        </div>
        <div>
          <Eb>{t('home.tr.rs.eyebrow')}</Eb>
          <h2 className="hv7-h2 hv7-h2-s" id="hv7-status-title">
            {t('home.tr.rs.title')}
          </h2>
          <ul className="hv7-list hv7-card">
            {rows.map(([name, status, tone]) => (
              <li key={name}>
                <Link prefetch={false} href="/corridors">
                  <i className="hv7-dot" data-tone={tone} aria-hidden="true" />
                  <span>{name}</span>
                  <em>{status}</em>
                </Link>
              </li>
            ))}
          </ul>
          <p className="hv7-small">
            {t('home.tr.rs.ready')} {steps}. {t('home.tr.rs.ready.end')}
          </p>
        </div>
      </div>
    </section>
  );
}

export function Trust() {
  const t = useT();
  return (
    <section className="hv7-band" id="trust" aria-labelledby="trust-title">
      <div className="hv7-card hv7-trust">
        <div>
          <Eb>{t(v43('trust.eyebrow'))}</Eb>
          <h2 className="hv7-h2" id="trust-title">
            {t(v43('trust.title'))}
          </h2>
          <Link prefetch={false} className="hv7-link" href="/trust">
            {t(v43('trust.link'))}
          </Link>
        </div>
        <ul className="hv7-ticks hv7-ticks-l">
          {sentences(t(v43('trust.lead'))).map((line) => (
            <li key={line}>
              <i aria-hidden="true">
                <CorridraIcon name="check" size={14} />
              </i>
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Example({ onFull }: { onFull: () => void }) {
  const t = useT();
  return (
    <section className="hv7-band" id="example" aria-labelledby="example-title">
      <Eb>
        {t(v43('ex.eyebrow'))} · {t(v43('ex.sample'))}
      </Eb>
      <h2 className="hv7-h2" id="example-title" tabIndex={-1}>
        {t('home.v44.eg.title')}
      </h2>
      <p className="hv7-sub">{t('home.v44.eg.lead')}</p>
      <ol className="hv7-cards">
        {four.map((n) => {
          const you = n % 2 === 1;
          return (
            <li key={n} className="hv7-card">
              <div className="hv7-card-top">
                <b data-who={you ? 'you' : 'team'}>
                  {t(you ? 'home.v44.eg.you' : 'home.v44.eg.team')}
                </b>
                <span>{t(`home.v44.eg.${n}.when` as MessageKey)}</span>
              </div>
              <strong>{t(`home.v44.eg.${n}.title` as MessageKey)}</strong>
              <span>{t(`home.v44.eg.${n}.line` as MessageKey)}</span>
            </li>
          );
        })}
      </ol>
      <div className="hv7-actions hv7-actions-l">
        <a className="hv7-link" href="#brief">
          {t(v43('ex.cta'))}
        </a>
        <button type="button" className="hv7-link" onClick={onFull}>
          {t(v43('ex.full'))}
        </button>
      </div>
    </section>
  );
}

export function Inbound({ onInbound }: { onInbound: () => void }) {
  const t = useT();
  return (
    <section className="hv7-band" id="inbound" aria-labelledby="inbound-title">
      <div className="hv7-inbound">
        <div>
          <Eb>
            <PlaceWords text={t(v43('inbound.eyebrow'))} />
          </Eb>
          <h2 className="hv7-h2 hv7-h2-s" id="inbound-title">
            <PlaceWords text={t(v43('inbound.title'))} />
          </h2>
          <p className="hv7-sub">{t(v43('inbound.text'))}</p>
          <button type="button" className="hv7-link" onClick={onInbound}>
            {t(v43('inbound.go'))}
          </button>
        </div>
        <div className="hv7-inbound-map" aria-hidden="true">
          <DotMap view="300 20 380 220" routes={['EU']} pins={['EU']} />
        </div>
      </div>
    </section>
  );
}

export function Faq() {
  const t = useT();
  return (
    <section className="hv7-band" id="questions" aria-labelledby="questions-title">
      <div className="hv7-faq">
        <div>
          <Eb>{t(v43('faq.eyebrow'))}</Eb>
          <h2 className="hv7-h2" id="questions-title">
            {t(v43('faq.title'))}
          </h2>
        </div>
        <div className="hv7-card hv7-faq-list">
          {faqIds.map((n) => (
            <details key={n}>
              <summary>{t(v43(`faq.${n}.q`))}</summary>
              <p>
                <PlaceWords text={t(v43(`faq.${n}.a`))} />
                {n === 6 ? (
                  <>
                    {' '}
                    <Link prefetch={false} href="/privacy">
                      {t(v43('faq.6.link'))}
                    </Link>
                  </>
                ) : null}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

const hideStartBarAt = [
  'main [data-start-action]',
  '#final',
  'footer',
];

export function Closing({ shown, href, cta }: { shown: Shown; href: string; cta: string }) {
  const t = useT();
  return (
    <>
      <section className="hv7-band" aria-labelledby="final-title">
        <div className="hv7-closing" id="final">
          <div className="hv7-closing-text">
            <Eb>{t('home.v44.close.eyebrow')}</Eb>
            <h2 id="final-title">
              {t('home.v44.close.a')} <span className="hv7-outline">{t('home.v44.close.b')}</span>{' '}
              {t('home.v44.close.c')}
            </h2>
            <a className="hv7-btn" href="#brief" id="final-start" data-start-action>
              {t(v43('hero.start'))}
            </a>
            <p className="hv7-small">{t('home.tr.fn.r1')}</p>
          </div>
          <div className="hv7-closing-map" aria-hidden="true">
            <DotMap view="360 50 260 140" routes={['CN']} pins={['CN']} />
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
