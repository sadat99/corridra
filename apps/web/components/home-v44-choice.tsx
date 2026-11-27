'use client';

import Link from 'next/link';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CorridraIcon } from './corridra-icon';
import { Sentence } from './home-v42-choice';
import { TalkLink } from './home-talk';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { v43 } from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v4.4 "Which way is your business moving?": the four routes as tabs, one panel for the chosen route (what it
// is, what the visitor can get) and the route map beside it. A tab choice moves no focus and opens nothing: the map,
// the example, the steps and the request follow it, as the v4.3 doors did. Same ids as v4.3 (home-route-group takes
// focus from "Start a Request"; home-start and #brief are the same targets), same words, same polite announcement.
const routes = ['china', 'sell', 'delegation', 'other'] as const;
const sol = { china: 'source', sell: 'sell', delegation: 'delegation' } as const;

export function HomeV44Choice({
  intent,
  href,
  cta,
  whatsapp,
  onChoose,
  map,
}: {
  intent: RouteKey;
  href: string;
  cta: string;
  whatsapp: string | null;
  onChoose: (route: RouteKey) => void;
  map: ReactNode;
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
    <section
      className="hv43-band hv43-choose hv44-choose"
      id="start"
      aria-labelledby="hv42-question"
    >
      <div id="pick" className="hv43-pick hv44-card">
        <div className="hv44-card-head">
          <h2 id="hv42-question">{t('home.tr.q')}</h2>
          <span className="label">{t(v43('q.sub'))}</span>
        </div>
        <div id="home-route-group" tabIndex={-1} className="hv44-tabs-wrap">
          <div className="hv44-tabs" role="tablist" aria-label={t('home.tr.q')}>
            {routes.map((route, index) => (
              <button
                key={route}
                type="button"
                role="tab"
                id={`hv44-tab-${route}`}
                aria-selected={intent === route}
                aria-controls="hv44-panel"
                tabIndex={intent === route ? 0 : -1}
                className="hv44-tab"
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
        <div className="hv44-pick">
          <div
            className="hv44-pick-main hv44-panel"
            id="hv44-panel"
            role="tabpanel"
            aria-labelledby={`hv44-tab-${intent}`}
          >
            <p className="label hv44-sentence">
              {intent === 'china' || intent === 'sell' ? (
                <Sentence route={intent} />
              ) : (
                <PlaceWords text={t(v43(`door.${intent}.line`))} />
              )}
            </p>
            <h3 className="hv44-panel-title">
              <PlaceWords text={t(v43(`door.${intent}.title`))} />
            </h3>
            {solution ? (
              <>
                <p className="hv44-panel-text">
                  <PlaceWords text={t(v43(`sol.${solution}.text`))} />
                </p>
                <div className="hv43-get hv44-get">
                  <strong>{t(v43('sol.get'))}</strong>
                  <span>{t(v43(`sol.${solution}.get`))}</span>
                </div>
              </>
            ) : (
              <p className="hv44-panel-text">
                <PlaceWords text={t(v43('door.other.line'))} />
              </p>
            )}
          </div>
          <div className="hv44-pick-map">{map}</div>
        </div>
        <div className="tr-start hv42-start hv44-start">
          <div className="tr-start-actions">
            <Link prefetch={false} className="primary-link" href={href} id="home-start">
              {cta}
            </Link>
            <TalkLink href={whatsapp} />
          </div>
          <ul className="ac1-calm">
            {(['account', 'send', 'stop'] as const).map((name) => (
              <li key={name}>
                <CorridraIcon name="check" size={16} />
                {t(`home.tr.assure.${name}` as MessageKey)}
              </li>
            ))}
          </ul>
          <p className="hv43-build">
            <a className="button-secondary" href="#brief">
              {t(v43('brief.go'))}
            </a>
            <span className="tr-small">{t(v43('q.note'))}</span>
          </p>
        </div>
      </div>
    </section>
  );
}
