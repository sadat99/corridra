import { PublicShell } from '../../components/public-shell';
import { DiscoveryExperience } from '../../components/discovery-experience';
import Link from 'next/link';
import { corridorPages } from '../../content/corridors';
import { Arrow } from '../../components/arrow';
export const metadata = { title: 'Commercial corridors | Corridra' };
export default function Page() {
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Routes</span>
          </nav>
          <p className="label">COMMERCIAL CORRIDORS</p>
          <h1>The job comes first. The route gives it context.</h1>
          <p className="guide-lead">
            Choose the company country and the market. Requirements, evidence, access and follow-up
            use the same mission workflow.
          </p>
        </div>
      </section>
      <DiscoveryExperience />
      <section className="guide-directions" aria-labelledby="directions-title">
        <h2 id="directions-title">Explore a direction</h2>
        <ul>
          {Object.entries(corridorPages).map(([slug, c]) => (
            <li key={slug}>
              <h3>{c.title}</h3>
              <p>{c.description}</p>
              <Link prefetch={false} href={`/corridors/${slug}`} className="text-link">
                Explore this direction <Arrow />
              </Link>
            </li>
          ))}
        </ul>
        <div className="guide-other-route">
          <div>
            <h3>Any other route</h3>
            <p>Corridra is built for any route. Pick two countries above, or start a mission.</p>
          </div>
          <Link prefetch={false} className="button-secondary" href="/plan">
            Plan a mission on another route <Arrow />
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
