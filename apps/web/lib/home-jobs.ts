import type { MessageKey } from './i18n/messages';

/** One of the three jobs on the home page. The link, its `?job=` value and its words never change with the order. */
export type HomeJob = {
  key: 'buy' | 'trip' | 'sell';
  href: string;
  title: MessageKey;
  text: MessageKey;
  /** The contract name, kept in the link's accessible name (P-07) and not drawn. */
  name: MessageKey;
  /** The route chip: only routes the repository already states (content/corridors.ts). */
  route: MessageKey;
  icon: string;
};

export const homeJobs: Record<HomeJob['key'], HomeJob> = {
  buy: {
    key: 'buy',
    href: '/plan?job=sourcing',
    title: 'home.start.buy.title',
    text: 'home.start.buy.text',
    name: 'home.start.buy.name',
    route: 'home.start.buy.route',
    icon: 'buy',
  },
  trip: {
    key: 'trip',
    href: '/plan?job=delegations',
    title: 'home.start.trip.title',
    text: 'home.start.trip.text',
    name: 'home.start.trip.name',
    route: 'home.start.trip.route',
    icon: 'trip',
  },
  sell: {
    key: 'sell',
    href: '/plan?job=buyers',
    title: 'home.start.sell.title',
    text: 'home.start.sell.text',
    name: 'home.start.sell.name',
    route: 'home.start.sell.route',
    icon: 'sell',
  },
};

/**
 * The order of the three jobs. Owner decision, 12 November 2026, "Equal weight": Buy, the group trip and Sell get the
 * same size, in the order Buy, trip, Sell.
 */
export const homeJobOrder: readonly HomeJob['key'][] = ['buy', 'trip', 'sell'];

/** The jobs in display order. */
export function orderedJobs(order: readonly HomeJob['key'][] = homeJobOrder) {
  return order.map((key) => homeJobs[key]);
}
