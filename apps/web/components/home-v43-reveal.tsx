'use client';

import { China, Delegation, Other } from './home-routes';
import { HomeSell } from './home-sell';
import { useT } from './language-provider';
import type { MarketKey, RouteKey } from '../lib/home-routes-data';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v4.3: the long route block (the shipped quotes, visit day, fair-cost calculator, programme table and
// "something else" page, each with its own Example tags). It is drawn only after a route is opened by an anchor, a
// "Full Example" action or "Walk Through a Sample Programme", never by choosing a door. The bar is this page's own
// markup and has no live region; All Routes closes the block and returns focus to the one Start a Request.
const showing: Record<RouteKey, MessageKey> = {
  china: 'home.tr.bar.china',
  sell: 'home.tr.bar.sell',
  delegation: 'home.tr.bar.delegationText',
  other: 'home.tr.bar.otherText',
};

export function HomeV43Reveal({
  open,
  market,
  whatsapp,
  onOpen,
  onClose,
  onMarket,
}: {
  open: RouteKey;
  market: MarketKey;
  whatsapp: string | null;
  onOpen: (route: RouteKey) => void;
  onClose: () => void;
  onMarket: (market: MarketKey) => void;
}) {
  const t = useT();
  return (
    <div className="hv42-reveal hv43-reveal" id="reveal">
      <div className="tr-bar">
        <p className="tr-bar-label">
          <span className="label">{t('home.tr.bar.showing')}</span> {t(showing[open])}
        </p>
        <div className="tr-bar-buttons" role="group" aria-label={t('home.tr.bar.aria')}>
          <button type="button" aria-pressed={false} onClick={onClose}>
            {t('home.tr.bar.all')}
          </button>
          {(['china', 'sell', 'delegation', 'other'] as const).map((route) => (
            <button
              key={route}
              type="button"
              aria-pressed={open === route}
              onClick={() => onOpen(route)}
            >
              {t(`home.tr.bar.${route}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      {open === 'china' ? <China /> : null}
      {open === 'sell' ? <HomeSell market={market} onMarket={onMarket} /> : null}
      {open === 'delegation' ? <Delegation whatsapp={whatsapp} /> : null}
      {open === 'other' ? <Other whatsapp={whatsapp} /> : null}
    </div>
  );
}
