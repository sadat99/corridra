'use client';

import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';
import { useT } from './language-provider';
import { orderedJobs } from '../lib/home-jobs';

/** The three jobs as links, as on the home page. The navigation keeps its name `Choose your commercial objective`. */
export function HomeJobs({ className = 'ac1-jobs' }: { className?: string }) {
  const t = useT();
  return (
    <nav className={className} aria-label={t('home.jobs.aria')}>
      {orderedJobs().map((job) => (
        <Link prefetch={false} key={job.href} href={job.href} className="ac1-job">
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
