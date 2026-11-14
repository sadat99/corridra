import type { PublicProgrammePage } from '@corridra/auth/customer-programme-publication';
import { pp } from '../../../lib/i18n/programme-pages';
import { ApplyLink } from './apply-link';
import type { ShareKitParts } from './share-kit';
import { ShareRow } from './share-row';

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

/** The public words of one programme, exactly as its organiser published them. Used by the public page and by the
 * organiser's preview, so what is previewed is what is published.
 * Composition (Meridian): the purpose, then where and when, then the one action with the facts a person weighs
 * before applying (fee, places, closing date) and what happens after it. Detail follows in one reading column. */
export function ProgrammePageView({
  page,
  url,
  preview = false,
  shareKit,
}: {
  page: Pick<PublicProgrammePage, 'state' | 'programme' | 'closesAt' | 'sample'> & {
    address?: string;
  };
  url?: string;
  preview?: boolean;
  /** The share kit (ADR-084 S1), drawn by the server and placed in the share section. Absent while its switch is off. */
  shareKit?: ShareKitParts;
}) {
  const p = page.programme;
  const open = page.state === 'OPEN';
  const confirmed = p.activities.filter((item) => item.status === 'CONFIRMED').length;
  return (
    <div className="programme-public">
      <p className="programme-public-lead">{p.summary}</p>
      {page.sample && (
        <p className="programme-public-note" role="note">
          {pp('pp.public.sampleNote')}
        </p>
      )}
      <dl className="programme-public-key">
        <div>
          <dt>{pp('pp.public.fact.where')}</dt>
          <dd>{p.destination}</dd>
        </div>
        <div>
          <dt>{pp('pp.public.fact.when')}</dt>
          <dd>{p.dates}</dd>
        </div>
      </dl>
      <section className="programme-public-apply" aria-labelledby="programme-apply-title">
        <h2 id="programme-apply-title">
          {open ? pp('pp.public.apply.title') : pp('pp.public.apply.closedTitle')}
        </h2>
        <dl className="programme-public-terms">
          <div>
            <dt>{pp('pp.public.fact.fee')}</dt>
            <dd>{p.fee ?? pp('pp.public.notStated')}</dd>
          </div>
          <div>
            <dt>{pp('pp.public.fact.places')}</dt>
            <dd>
              {p.capacity
                ? pp('pp.public.placesPlanned', { count: p.capacity })
                : pp('pp.public.notStated')}
            </dd>
          </div>
          <div>
            <dt>{open ? pp('pp.public.apply.closes') : pp('pp.public.apply.closedOn')}</dt>
            <dd>
              <time dateTime={page.closesAt}>
                {pp('pp.public.dateUtc', { date: day(page.closesAt) })}
              </time>
            </dd>
          </div>
        </dl>
        {open ? (
          <>
            {preview || !page.address ? (
              <p className="programme-public-note">{pp('pp.public.apply.previewNote')}</p>
            ) : (
              <ApplyLink address={page.address} title={p.title} />
            )}
            <p className="programme-public-note">{pp('pp.public.apply.text')}</p>
            <h3>{pp('pp.public.next.title')}</h3>
            <ol className="programme-public-next">
              <li>{pp('pp.public.next.1')}</li>
              <li>{pp('pp.public.next.2')}</li>
              <li>{pp('pp.public.next.3')}</li>
            </ol>
          </>
        ) : (
          <p>{pp('pp.public.apply.closedText')}</p>
        )}
      </section>
      <dl className="programme-public-facts">
        <div>
          <dt>{pp('pp.public.fact.organiser')}</dt>
          <dd>{p.organiser}</dd>
        </div>
        <div>
          <dt>{pp('pp.public.fact.focus')}</dt>
          <dd>{p.focus}</dd>
        </div>
      </dl>
      <section aria-labelledby="programme-who-title">
        <h2 id="programme-who-title">{pp('pp.public.who.title')}</h2>
        <p>{p.audience}</p>
        <h3>{pp('pp.public.who.takePart')}</h3>
        <p>{p.eligibility}</p>
      </section>
      {p.activities.length > 0 && (
        <section aria-labelledby="programme-plan-title">
          <div className="programme-public-heading">
            <h2 id="programme-plan-title">{pp('pp.public.plan.title')}</h2>
            <p className="programme-public-note">
              {pp('pp.public.plan.count', {
                confirmed,
                planned: p.activities.length - confirmed,
              })}
            </p>
          </div>
          <ol className="programme-public-plan">
            {p.activities.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <span className="programme-public-state" data-status={item.status}>
                  {item.status === 'CONFIRMED'
                    ? pp('pp.public.plan.confirmed')
                    : pp('pp.public.plan.planned')}
                </span>
              </li>
            ))}
          </ol>
          <p className="programme-public-note">{pp('pp.public.plan.note')}</p>
        </section>
      )}
      {(p.included.length > 0 || p.excluded.length > 0) && (
        <section aria-labelledby="programme-fee-title" className="programme-public-pair">
          <h2 id="programme-fee-title" className="sr-only">
            {pp('pp.public.fee.title')}
          </h2>
          {p.included.length > 0 && (
            <div>
              <h3>{pp('pp.public.fee.included')}</h3>
              <ul>
                {p.included.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {p.excluded.length > 0 && (
            <div>
              <h3>{pp('pp.public.fee.excluded')}</h3>
              <ul>
                {p.excluded.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      <section aria-labelledby="programme-who-runs-title">
        <h2 id="programme-who-runs-title">{pp('pp.public.responsible.title')}</h2>
        <p>{pp('pp.public.responsible.text', { organiser: p.organiser })}</p>
      </section>
      {url && !preview && <ShareRow url={url} title={p.title} kit={shareKit} />}
    </div>
  );
}
