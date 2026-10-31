import { PublicShell } from '../../components/public-shell';
import { DiscoveryExperience } from '../../components/discovery-experience';
import Link from 'next/link';
import { corridorPages } from '../../content/corridors';
import { Arrow } from '../../components/arrow';
export const metadata = {
  title: 'Routes | Corridra',
  description: 'We start with Bangladesh to China, Spain and the EU. Ask us about other routes.',
};
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
          <p className="label">Routes</p>
          <h1>The job comes first. The route gives it context.</h1>
          <p className="guide-lead">
            We start with Bangladesh to China, Spain and the EU. Ask us about other routes. Pick
            where your company is and the market you want to reach, and every request follows the
            same steps.
          </p>
        </div>
      </section>
      <DiscoveryExperience />
      <section className="guide-directions" aria-labelledby="directions-title">
        <h2 id="directions-title">Explore a route</h2>
        <ul>
          {Object.entries(corridorPages).map(([slug, c]) => (
            <li key={slug}>
              <h3>{c.title}</h3>
              <p>{c.description}</p>
              <Link prefetch={false} href={`/corridors/${slug}`} className="text-link">
                Explore this route <Arrow />
              </Link>
            </li>
          ))}
        </ul>
        <div className="guide-other-route">
          <div>
            <h3>Any other route</h3>
            <p>Tell us the two countries in a request and we will say whether we can help.</p>
          </div>
          <Link prefetch={false} className="button-secondary" href="/plan">
            Plan a mission on another route <Arrow />
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
