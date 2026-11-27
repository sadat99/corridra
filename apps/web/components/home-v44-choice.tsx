'use client';

import { useRef, type KeyboardEvent } from 'react';
import { CorridraIcon } from './corridra-icon';
import { DotMap, type SpotKey } from './home-v44-dotmap';
import { Sentence } from './home-v42-choice';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { v43 } from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v4.4 "Which way is your business moving?": the four routes as tabs, one panel for the chosen route (what it
// is, what the visitor can get) and the route map beside it. A tab choice moves no focus and opens nothing: the map,
// the example, the steps and the request follow it, as the v4.3 doors did. Same ids as v4.3 (home-route-group, #brief). The panel has no button of its own: the page's Start a Request opens the sheet, same words, same polite announcement.
const routes = ['china', 'sell', 'delegation', 'other'] as const;
const mapFor: Record<RouteKey, { view: string; routes: SpotKey[] }> = {
  china: { view: '430 40 230 130', routes: ['CN', 'SG'] },
  sell: { view: '120 20 560 190', routes: ['EU', 'UK', 'US'] },
  delegation: { view: '380 40 300 200', routes: ['CN', 'AU', 'AE'] },
  other: { view: '470 70 150 90', routes: [] },
};
const sol = { china: 'source', sell: 'sell', delegation: 'delegation' } as const;

export function HomeV44Choice({
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
            key={intent}
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
          <div className="hv44-pick-map" key={`m-${intent}`}>
            <DotMap
              view={mapFor[intent].view}
              routes={mapFor[intent].routes}
              pins={mapFor[intent].routes}
            />
          </div>
        </div>
        <div className="tr-start hv42-start hv44-start">
          <ul className="ac1-calm">
            {(['account', 'send', 'stop'] as const).map((name) => (
              <li key={name}>
                <CorridraIcon name="check" size={16} />
                {t(`home.tr.assure.${name}` as MessageKey)}
              </li>
            ))}
          </ul>
          <p className="tr-small hv44-pick-note">{t(v43('q.note'))}</p>
        </div>
      </div>
    </section>
  );
}
