'use client';

import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';
import { useT } from './language-provider';
import type { MessageKey } from '../lib/i18n/messages';

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
 * The order and weight of the three jobs (owner decision, 12 November 2026: the jobs are unequal by default).
 * The first job leads with a larger card, the second is a normal row and the last is compact but always visible.
 * To change which job leads, reorder this list; nothing else needs to change.
 */
export const homeJobOrder: readonly HomeJob['key'][] = ['buy', 'trip', 'sell'];

const weights = ['lead', 'normal', 'compact'] as const;
export type JobWeight = (typeof weights)[number];

/** The jobs in display order, each with its weight. */
export function orderedJobs(order: readonly HomeJob['key'][] = homeJobOrder) {
  return order.map((key, index) => ({
    job: homeJobs[key],
    weight: weights[Math.min(index, weights.length - 1)],
  }));
}

/** The three jobs as links, as on the home page. The navigation keeps its name `Choose your commercial objective`. */
export function HomeJobs({ className = 'ac1-jobs' }: { className?: string }) {
  const t = useT();
  return (
    <nav className={className} aria-label={t('home.jobs.aria')}>
      {orderedJobs().map(({ job, weight }) => (
        <Link
          prefetch={false}
          key={job.href}
          href={job.href}
          className="ac1-job"
          data-weight={weight}
        >
          <CorridraIcon name={job.icon} className="ac1-job-icon" />
          <span className="ac1-job-words">
            <strong>{t(job.title)}</strong>
            <span className="ac1-job-text">{t(job.text)}</span>
            <span className="ac1-job-route">{t(job.route)}</span>
            <span className="label ac1-job-name">{t(job.name)}</span>
          </span>
          <CorridraIcon name="arrow" className="ac1-job-go" />
        </Link>
      ))}
    </nav>
  );
}
