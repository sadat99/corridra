import type { MessageKey } from '../lib/i18n/messages';

/** Every way to start work. Kept in the footer of every page so no destination is lost. */
export const waysToWork: readonly { href: string; label: string; key: MessageKey }[] = [
  { href: '/source', label: 'Source products and suppliers', key: 'way.source' },
  { href: '/machinery', label: 'Procure machinery', key: 'way.machinery' },
  { href: '/trade-missions', label: 'Run a trade mission', key: 'way.tradeMissions' },
  { href: '/business-trips', label: 'Plan a business trip', key: 'way.businessTrips' },
  { href: '/sell', label: 'Sell in a new market', key: 'way.sell' },
  { href: '/enter-market', label: 'Enter a new market', key: 'way.enterMarket' },
];
