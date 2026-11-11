import type { PublicProgrammePage } from '@corridra/auth/customer-programme-publication';
import { ApplyLink } from './apply-link';
import { ShareRow } from './share-row';

const day = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

/** The public words of one programme, exactly as its organiser published them. Used by the public page and by the
 * organiser's preview, so what is previewed is what is published. */
export function ProgrammePageView({
  page,
  url,
  preview = false,
}: {
  page: Pick<PublicProgrammePage, 'state' | 'programme' | 'closesAt' | 'sample'> & {
    address?: string;
  };
  url?: string;
  preview?: boolean;
}) {
  const p = page.programme;
  const open = page.state === 'OPEN';
  return (
    <div className="programme-public">
      <p className="programme-public-lead">{p.summary}</p>
      {page.sample && (
        <p className="programme-public-note" role="note">
          This is a sample page. The programme and the organiser on it are examples, not real
          offers.
        </p>
      )}
      <dl className="programme-public-facts">
        <div>
          <dt>Organised by</dt>
          <dd>{p.organiser}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{p.destination}</dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>{p.dates}</dd>
        </div>
        <div>
          <dt>Focus</dt>
          <dd>{p.focus}</dd>
        </div>
        <div>
          <dt>Places</dt>
          <dd>{p.capacity ? `${p.capacity} planned` : 'Not stated yet'}</dd>
        </div>
        <div>
          <dt>Fee</dt>
          <dd>{p.fee ?? 'Not stated yet'}</dd>
        </div>
      </dl>
      <section className="programme-public-apply" aria-labelledby="programme-apply-title">
        <h2 id="programme-apply-title">{open ? 'Apply for a place' : 'Applications are closed'}</h2>
        {open ? (
          <>
            <p>
              Applications close on <time dateTime={page.closesAt}>{day(page.closesAt)}</time>{' '}
              (UTC). You apply with a free Corridra account. The organiser reads your application
              and answers it. Applying is not a booking and no fee is taken on this page.
            </p>
            {preview || !page.address ? (
              <p className="programme-public-note">
                The Apply button appears here on the published page.
              </p>
            ) : (
              <ApplyLink address={page.address} title={p.title} />
            )}
          </>
        ) : (
          <p>
            Applications closed on <time dateTime={page.closesAt}>{day(page.closesAt)}</time> (UTC).
            The organiser may open them again.
          </p>
        )}
      </section>
      <section aria-labelledby="programme-who-title">
        <h2 id="programme-who-title">Who it is for</h2>
        <p>{p.audience}</p>
        <h3>To take part</h3>
        <p>{p.eligibility}</p>
      </section>
      {p.activities.length > 0 && (
        <section aria-labelledby="programme-plan-title">
          <h2 id="programme-plan-title">The programme</h2>
          <ul className="programme-public-plan">
            {p.activities.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <span className="programme-public-state">
                  {item.status === 'CONFIRMED' ? 'Confirmed' : 'Planned'}
                </span>
              </li>
            ))}
          </ul>
          <p className="programme-public-note">
            Planned means the organiser intends it and has not confirmed it. Confirmed is the
            organiser&apos;s own statement.
          </p>
        </section>
      )}
      {(p.included.length > 0 || p.excluded.length > 0) && (
        <section aria-labelledby="programme-fee-title" className="programme-public-pair">
          <h2 id="programme-fee-title" className="sr-only">
            What the fee covers
          </h2>
          {p.included.length > 0 && (
            <div>
              <h3>Included</h3>
              <ul>
                {p.included.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {p.excluded.length > 0 && (
            <div>
              <h3>Not included</h3>
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
        <h2 id="programme-who-runs-title">Who is responsible</h2>
        <p>
          {p.organiser} runs this programme and is responsible for it, its fee and what it includes.
          Everything on this page is stated by the organiser. Corridra provides the tools the
          organiser uses. Corridra is not the travel operator and has not checked these details.
        </p>
      </section>
      {url && !preview && <ShareRow url={url} title={p.title} />}
    </div>
  );
}
