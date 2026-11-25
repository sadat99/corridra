import { PublicShell } from '../../components/public-shell';
import { DiscoveryExperience } from '../../components/discovery-experience';
import Link from 'next/link';
import { destinationRows } from '../../content/corridors';
import { Arrow } from '../../components/arrow';
import { Flagged } from '../../components/ux/flag';
import '../../components/page-compact.css';
import './corridors.css';
import '../../components/public-body.css';
export const metadata = {
  title: 'Routes | Corridra',
  description:
    'From Bangladesh we run missions to China, the EU, the UK, the US, Australia and key Asian markets. Ask us about any other route.',
};
export default function Page() {
  return (
    <PublicShell>
      <section className="guide-page-hero guide-page-hero--compact">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Routes</span>
          </nav>
          <p className="label">Routes</p>
          <h1>Routes from Bangladesh</h1>
          <p className="guide-lead">Pick where you want to work.</p>
          <p className="guide-route-steps">Every route follows the same steps.</p>
        </div>
      </section>
      <DiscoveryExperience
        linkedOnPage={[...destinationRows.map((row) => row.href), '/corridors/bangladesh-spain']}
        about={
          <>
            <h2>The job comes first. The route gives it context.</h2>
            <p>
              We run missions from Bangladesh. Open now: China, the EU, the UK, the US, Australia
              and key Asian markets. Pick where your company is and the market you want to reach,
              and every request follows the same steps.
            </p>
            <p className="guide-route-note">
              Selling in Spain?{' '}
              <Link prefetch={false} href="/corridors/bangladesh-spain" className="text-link">
                Spain
              </Link>
            </p>
          </>
        }
      >
        <section className="guide-directions" aria-labelledby="directions-title">
          <h2 id="directions-title" className="sr-only">
            Explore a route
          </h2>
          {/* Owner decisions 17 and 18 Nov 2026 (routes and markets) and UI/UX.v4.1 L5 (23 Nov 2026): one numbered
              list of six rows of the same size in the locked order. Each row has its 40 px mark (a flag, or the
              compass mark for Key Asian Markets) before the written name, the word Open and one quiet link. */}
          <ol className="guide-direction-list">
            {destinationRows.map((row, index) => (
              <li key={row.key} className="guide-direction-row">
                <span className="guide-direction-n" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="guide-direction-text">
                  <h3>
                    <Flagged code={row.mark} size="row">
                      {row.name}
                    </Flagged>
                  </h3>
                  <p>{row.tagline}</p>
                </div>
                <span className="guide-direction-open guide-tag" data-tone="positive">
                  Open
                </span>
                <Link
                  prefetch={false}
                  id={`route-${row.key}`}
                  href={row.href}
                  className="text-link"
                  aria-label={`See This Route: ${row.name}`}
                >
                  See This Route <Arrow />
                </Link>
              </li>
            ))}
          </ol>
          <div className="guide-other-route">
            <div>
              <h3>Another route?</h3>
              <p>No operating offer announced. We tell you plainly if we can help.</p>
            </div>
            {/* One link per destination and one primary on the page: the route picker below holds the primary, so
                this block has one quiet action to the request form (it was written twice here). */}
            <div className="guide-other-actions">
              <Link prefetch={false} className="button-secondary" href="/plan">
                Plan a Mission on Another Route <Arrow />
              </Link>
              <Link prefetch={false} className="text-link" href="#mission-example">
                See a Sample Mission
              </Link>
            </div>
          </div>
        </section>
      </DiscoveryExperience>
    </PublicShell>
  );
}
