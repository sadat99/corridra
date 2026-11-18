import { PublicShell } from '../../components/public-shell';
import { DiscoveryExperience } from '../../components/discovery-experience';
import Link from 'next/link';
import { corridorPages, destinationRows, openNote } from '../../content/corridors';
import { Arrow } from '../../components/arrow';
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
          <h1>The job comes first. The route gives it context.</h1>
          <p className="guide-lead">
            We run missions from Bangladesh. Open now: China, the EU, the UK, the US, Australia and
            key Asian markets. Pick where your company is and the market you want to reach, and
            every request follows the same steps.
          </p>
          <Link prefetch={false} className="primary-link guide-hero-start" href="/plan">
            Start a Request
          </Link>
        </div>
      </section>
      <DiscoveryExperience>
        <section className="guide-directions" aria-labelledby="directions-title">
          <h2 id="directions-title">Explore a route</h2>
          <ul>
            {/* Owner decisions 17 and 18 Nov 2026, routes and markets: six open destinations as equal rows in this
                order. Spain stays a plain link inside the EU row, so its page is never orphaned. */}
            {destinationRows.map((row) => (
              <li key={row.key} className="guide-direction-row">
                <h3>{row.name}</h3>
                <p>{'slug' in row ? corridorPages[row.slug].description : openNote}</p>
                {'slug' in row ? (
                  <Link prefetch={false} href={`/corridors/${row.slug}`} className="text-link">
                    Explore this route <Arrow />
                  </Link>
                ) : (
                  <Link prefetch={false} href={row.href} className="text-link">
                    {row.link} <Arrow />
                  </Link>
                )}
                {row.key === 'eu' ? (
                  <p className="guide-route-note">
                    Selling in Spain?{' '}
                    <Link prefetch={false} href="/corridors/bangladesh-spain" className="text-link">
                      Spain
                    </Link>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="guide-other-route">
            <div>
              <h3>Any other route</h3>
              <p>No operating offer announced. We tell you plainly if we can help.</p>
            </div>
            <Link prefetch={false} className="button-secondary" href="/plan">
              Plan a Mission on Another Route <Arrow />
            </Link>
          </div>
        </section>
      </DiscoveryExperience>
    </PublicShell>
  );
}
