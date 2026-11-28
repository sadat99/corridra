'use client';

import Link from 'next/link';
import { RoutesSection } from './home-more';
import { Toggle } from './home-v43-toggle';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { Eyebrow } from './ux/example-tag';
import { Flagged } from './ux/flag';
import {
  explorerMarkets,
  marketLine,
  marketPlace,
  placeFlag,
  placeName,
  routeRecord,
  v43,
  type Direction,
  type ExplorerMarket,
  type PlaceCode,
} from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';
import { fill } from '../lib/i18n/fill';

// Home page v4.3 markets explorer. No canvas and nothing moves: two endpoint chips joined by a CSS rule (solid when the
// route is open, dashed when it is assessed case by case, with the status always written beside it), so there is no
// Pause control and reduced motion is safe by construction. Key Asian Markets shows the compass mark and its name,
// never a flag, and is never written as a sentence "Bangladesh to Key Asian Markets": the route is two labelled chips.
export function HomeV43Markets({
  market,
  direction,
  mine,
  onMarket,
  onDirection,
  onUse,
  announce,
  routes = true,
}: {
  market: ExplorerMarket;
  direction: Direction;
  mine: RouteKey | null;
  onMarket: (market: ExplorerMarket) => void;
  onDirection: (direction: Direction) => void;
  onUse: () => void;
  announce: (text: string) => void;
  /** Home page v4.4 draws the route statuses itself, once, so it turns this copy off. */
  routes?: boolean;
}) {
  const t = useT();
  const record = routeRecord(market, direction);
  const chip = (code: PlaceCode, size?: 'row') => (
    <Flagged code={placeFlag[code]} size={size}>
      {t(placeName[code])}
    </Flagged>
  );
  const endpoints = (
    <>
      <span className="hv43-endpoint">
        {chip(record.origin)}
        <span className="label">{t(v43('mk.origin'))}</span>
      </span>
      <span className="hv43-endpoint">
        {chip(record.destination)}
        <span className="label">{t(v43('mk.destination'))}</span>
      </span>
    </>
  );
  return (
    <>
      <section className="hv43-band hv43-markets" id="markets" aria-labelledby="markets-title">
        <header className="hv43-head">
          <div>
            <Eyebrow>{t(v43('mk.eyebrow'))}</Eyebrow>
            <h2 id="markets-title">{t(v43('mk.title'))}</h2>
          </div>
          <p>{t(v43('mk.lead'))}</p>
        </header>
        <div className="hv43-explorer">
          <div role="group" aria-label={t(v43('mk.group'))}>
            <ul className="hv43-markets-list">
              {explorerMarkets.map((m) => (
                <li key={m}>
                  <Toggle
                    className="hv43-market"
                    on={market === m}
                    describedBy={`market-line-${m}`}
                    onPress={() => {
                      onMarket(m);
                      announce(fill(t(v43('live.chosen')), { item: t(placeName[marketPlace[m]]) }));
                    }}
                  >
                    <Flagged code={placeFlag[marketPlace[m]]} size="row">
                      {t(placeName[marketPlace[m]])}
                    </Flagged>
                  </Toggle>
                  <span id={`market-line-${m}`} className="hv43-market-line">
                    {t(marketLine(m, direction))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="hv43-inspector">
            <div className="hv43-segments" role="group" aria-label={t(v43('mk.dir.group'))}>
              {(['out', 'in'] as const).map((d) => (
                <Toggle
                  key={d}
                  on={direction === d}
                  onPress={() => {
                    onDirection(d);
                    announce(
                      fill(t(v43('live.chosen')), {
                        item: fill(t(v43(`mk.dir.${d}`)), { bd: t(placeName.BD) }),
                      }),
                    );
                  }}
                >
                  <PlaceWords text={t(v43(`mk.dir.${d}`))} />
                </Toggle>
              ))}
            </div>
            <div className="hv43-schematic" data-status={record.tone} aria-hidden="true">
              {endpoints}
            </div>
            <p className="hv43-caption">{t(v43('mk.schematic'))}</p>
            <div className="hv43-record" role="group" aria-labelledby="markets-record-status">
              <div className="hv43-chips">
                {record.origin === 'REGION' || record.destination === 'REGION' ? (
                  endpoints
                ) : (
                  <>
                    {chip(record.origin)} <span>{t('home.b3.to')}</span> {chip(record.destination)}
                  </>
                )}
              </div>
              <strong id="markets-record-status">{t(record.status)}</strong>
              <p>{t(record.detail)}</p>
            </div>
            <div className="hv43-explorer-actions">
              <button type="button" className="primary-link" onClick={onUse}>
                {t(v43('mk.use'))}
              </button>
              <Link prefetch={false} className="text-link" href="/corridors">
                {t(v43('mk.all'))}
              </Link>
            </div>
          </div>
        </div>
        <Link prefetch={false} className="text-link" href="/corridors#mission-example">
          {t(v43('mk.dossier'))}
        </Link>
      </section>
      {routes ? (
        <RoutesSection
          mine={mine === 'delegation' ? null : mine}
          flags
          links={false}
          readyLead={t('home.b3.rs.ready')}
          v42
          limits={false}
          allRoutes={false}
        />
      ) : null}
    </>
  );
}
