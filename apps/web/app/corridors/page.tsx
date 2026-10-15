import { PublicShell } from '../../components/public-shell';
import { DiscoveryExperience } from '../../components/discovery-experience';
import Link from 'next/link';
import { corridorPages } from '../../content/corridors';
import { MarketSelector } from '../../components/market-selector';
export const metadata = { title: 'Commercial corridors | Corridra' };
export default function Page() {
  return (
    <PublicShell>
      <section className="page-hero">
        <p className="label">COMMERCIAL CORRIDORS</p>
        <h1>The job comes first. The route gives it context.</h1>
        <p className="page-description">
          Choose the company country and market involved. Requirements, evidence, access and
          follow-up use the same mission workflow.
        </p>
      </section>
      <DiscoveryExperience overview />
      <section className="detail-section">
        <div className="detail-grid">
          {Object.entries(corridorPages).map(([slug, c]) => (
            <article className="detail-card" key={slug}>
              <h2>{c.title}</h2>
              <p>{c.description}</p>
              <Link href={`/corridors/${slug}`} className="text-link">
                Explore this direction
              </Link>
            </article>
          ))}
          <article className="detail-card ux-route-other">
            <div>
              <h2>Any other route</h2>
              <p>
                Corridra is built for any route between countries. Pick two countries on the map
                above, or use the selector below, and start a mission from there.
              </p>
            </div>
          </article>
        </div>
        <MarketSelector />
      </section>
    </PublicShell>
  );
}
