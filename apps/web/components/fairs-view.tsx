import Link from 'next/link';
import type { Fair } from '../content/fairs';
import { Countdown } from './countdown';
import { datesLastChecked, fairDateKinds, fairDateWords, nextFairDate } from '../lib/fairs';

/** The list of fairs the Corridra team has checked. Data in, markup out: the pages decide what is shown. */
export function FairsIndexView({ list, today }: { list: readonly Fair[]; today: string }) {
  return (
    <>
      <p className="fairs-note">
        Each date below was read on the fair&apos;s own site by a person in the Corridra team. The
        day it was checked is shown. A date we have not checked is not shown.
      </p>
      {list.length === 0 ? (
        <div className="ux-empty">
          <p>No fairs are listed yet.</p>
          <p>
            Going to a trade fair? Tell us which one and we will help you plan who to meet and what
            to follow up.
          </p>
          <Link className="primary-link" href="/plan?job=trade_fairs">
            Ask us about a fair
          </Link>
        </div>
      ) : (
        <ul className="fairs-list">
          {list.map((fair) => {
            const next = nextFairDate(fair, today);
            return (
              <li key={fair.slug}>
                <h2>
                  <Link href={`/fairs/${fair.slug}`}>{fair.name}</Link>
                </h2>
                <p>
                  {fair.city}, {fair.countryCode}
                </p>
                {next ? (
                  <p>
                    {fairDateWords[next.kind]} <time dateTime={next.on}>{next.on}</time> ·{' '}
                    <Countdown on={next.on} today={today} />
                  </p>
                ) : (
                  <p>No upcoming date has been announced or checked.</p>
                )}
                <p className="fairs-checked">Dates last checked {datesLastChecked(fair)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** One fair: each stated date with its source, who read it and when. */
export function FairDetailView({ fair, today }: { fair: Fair; today: string }) {
  const next = nextFairDate(fair, today);
  const ordered = fairDateKinds
    .map((kind) => fair.dates.find((date) => date.kind === kind))
    .filter((date) => date !== undefined);
  return (
    <>
      <p>
        {fair.city}, {fair.countryCode} ·{' '}
        <a className="text-link" href={fair.website} rel="noopener noreferrer">
          The fair&apos;s own site
        </a>
      </p>
      <p className="fairs-checked">Dates last checked {datesLastChecked(fair)}</p>
      <dl className="fairs-dates">
        {ordered.map((date) => (
          <div key={date.kind}>
            <dt>{fairDateWords[date.kind]}</dt>
            <dd>
              {date.on ? (
                <>
                  <time dateTime={date.on}>{date.on}</time> ·{' '}
                  <Countdown on={date.on} today={today} next={date.on < today ? next : null} />
                </>
              ) : (
                'Not announced yet'
              )}
              <span className="fairs-source">
                Read on{' '}
                <a className="text-link" href={date.source} rel="noopener noreferrer">
                  the fair&apos;s page
                </a>{' '}
                by {date.verifiedBy} on <time dateTime={date.verifiedOn}>{date.verifiedOn}</time>
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <Link className="text-link" href="/fairs">
        All fairs we have checked
      </Link>
    </>
  );
}
