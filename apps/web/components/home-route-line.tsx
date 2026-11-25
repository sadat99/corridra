'use client';

import { RouteLine as SharedRouteLine, type FlagCode, type PlaceMark } from './ux/flag';
import { useT } from './language-provider';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import type { MarketKey } from '../lib/home-routes-data';

// The two open routes of the home, written with the shared route line (components/ux/flag.tsx). Key Asian Markets is
// a region: the compass mark, never a flag (owner flag policy, 17 November 2026).
const key = (name: string) => name as HomeRoutesKey;
const marketMarks: Record<MarketKey, FlagCode | 'region'> = {
  eu: 'eu',
  gb: 'gb',
  us: 'us',
  au: 'au',
  asia: 'region',
};

export function RouteLine({
  route,
  markets: which = 'all',
}: {
  route: 'china' | 'sell';
  /**
   * Home page v4.2 (owner, 25 Nov 2026: remove "Key Asian Markets" from the Sell Abroad route line and the route
   * status card): `noKeyAsian` leaves the region out of the Sell line. Left out, every market shows as before.
   */
  markets?: 'all' | 'noKeyAsian';
}) {
  const t = useT();
  const markets = (Object.keys(marketMarks) as MarketKey[]).filter(
    (m) => which === 'all' || m !== 'asia',
  );
  return (
    <SharedRouteLine
      from={{ name: t('home.country.bd'), mark: 'bd' }}
      word={t('home.b3.to')}
      to={
        route === 'china'
          ? [{ name: t('home.country.cn'), mark: 'cn' }]
          : markets.map((m) => ({ name: t(key(`home.tr.mk.${m}`)), mark: marketMarks[m] }))
      }
    />
  );
}

/** The mark beside one market's name. */
export function marketFlag(market: MarketKey): PlaceMark {
  return marketMarks[market];
}
