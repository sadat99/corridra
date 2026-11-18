'use client';

import { Flagged, type FlagCode } from './flag';
import { useT } from './language-provider';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import type { MarketKey } from '../lib/home-routes-data';

// A route written as its places, each country with its flag beside the name (owner flag policy, 17 November 2026).
// Key Asian Markets is a region: its name and no flag. Screen readers hear the names once, with commas between.
const key = (name: string) => name as HomeRoutesKey;
const marketFlags: Record<MarketKey, FlagCode | null> = {
  eu: 'eu',
  gb: 'gb',
  us: 'us',
  au: 'au',
  asia: null,
};

export function RouteLine({ route }: { route: 'china' | 'sell' }) {
  const t = useT();
  const markets = Object.keys(marketFlags) as MarketKey[];
  return (
    <span className="tr-route-line">
      <Flagged code="bd">{t('home.country.bd')}</Flagged>{' '}
      <span className="tr-route-to">{t('home.b3.to')}</span>{' '}
      {route === 'china' ? (
        <Flagged code="cn">{t('home.country.cn')}</Flagged>
      ) : (
        markets.map((m, i) => (
          <span key={m} className="tr-route-place">
            <Flagged code={marketFlags[m]}>{t(key(`home.tr.mk.${m}`))}</Flagged>
            {i < markets.length - 1 ? <span className="sr-only">, </span> : null}{' '}
          </span>
        ))
      )}
    </span>
  );
}

/** The flag of one market chip, or none for a region. */
export function marketFlag(market: MarketKey): FlagCode | null {
  return marketFlags[market];
}
