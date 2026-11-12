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
 * The order of the three jobs. Owner decision, 12 November 2026 ("Equal weight"): Buy, the group trip and Sell are
 * drawn at the same size and weight, in this order. To change the order, reorder this list.
 */
export const homeJobOrder: readonly HomeJob['key'][] = ['buy', 'trip', 'sell'];

/**
 * The job drawn larger than the others, or null for equal weight (the owner's current decision). Setting a key here
 * makes that job the lead card and the others compact, with no other change.
 */
export const homeJobLead: HomeJob['key'] | null = null;

export type JobWeight = 'equal' | 'lead' | 'compact';

/** The jobs in display order, each with its weight. */
export function orderedJobs(
  order: readonly HomeJob['key'][] = homeJobOrder,
  lead: HomeJob['key'] | null = homeJobLead,
) {
  return order.map((key) => ({
    job: homeJobs[key],
    weight: (lead === null ? 'equal' : key === lead ? 'lead' : 'compact') as JobWeight,
  }));
}
