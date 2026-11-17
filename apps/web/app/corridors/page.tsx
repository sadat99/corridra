import { PublicShell } from '../../components/public-shell';
import { DiscoveryExperience } from '../../components/discovery-experience';
import Link from 'next/link';
import { corridorPages } from '../../content/corridors';
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
            {/* Owner decision 17 Nov 2026, routes and markets: the open destinations are shown as equals. The Spain page stays
                reachable at its own address but is not offered as a route here. */}
            {(['bangladesh-china', 'bangladesh-eu'] as const).map((slug) => (
              <li key={slug}>
                <h3>{corridorPages[slug].title}</h3>
                <p>{corridorPages[slug].description}</p>
                <Link prefetch={false} href={`/corridors/${slug}`} className="text-link">
                  Explore this route <Arrow />
                </Link>
              </li>
            ))}
            {(
              [
                ['Bangladesh to the UK', 'GB'],
                ['Bangladesh to the US', 'US'],
                ['Bangladesh to Australia', 'AU'],
              ] as const
            ).map(([name, market]) => (
              <li key={market} className="guide-direction-compact">
                <h3>
                  <Link
                    prefetch={false}
                    href={`/plan?companyCountry=BD&marketCode=${market}`}
                    className="text-link"
                  >
                    {name} <Arrow />
                  </Link>
                </h3>
              </li>
            ))}
            <li key="asia" className="guide-direction-compact">
              <h3>
                <Link prefetch={false} href="/plan?companyCountry=BD" className="text-link">
                  Bangladesh to key Asian markets <Arrow />
                </Link>
              </h3>
            </li>
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
