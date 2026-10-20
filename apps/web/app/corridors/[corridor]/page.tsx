import { PublicShell } from '../../../components/public-shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { corridorPages } from '../../../content/corridors';
import { Lines } from '../../../components/public-page';
export function generateStaticParams() {
  return Object.keys(corridorPages).map((corridor) => ({ corridor }));
}
async function content(params: Promise<{ corridor: string }>) {
  const { corridor } = await params;
  const c = corridorPages[corridor as keyof typeof corridorPages];
  if (!c) notFound();
  return c;
}
export async function generateMetadata({ params }: { params: Promise<{ corridor: string }> }) {
  const c = await content(params);
  return { title: `${c.title} | Corridra`, description: c.description };
}
export default async function Page({ params }: { params: Promise<{ corridor: string }> }) {
  const c = await content(params);
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <Link prefetch={false} href="/corridors">
              Routes
            </Link>
          </nav>
          <p className="label">{c.title}</p>
          <h1>
            <Lines text={c.heading} />
          </h1>
          <p className="guide-lead">{c.description}</p>
          <div className="guide-page-actions">
            <Link
              prefetch={false}
              className="primary-link"
              href={`/plan?companyCountry=BD&marketCode=${c.market}`}
            >
              Prepare a test mission request
            </Link>
          </div>
        </div>
      </section>
      <section className="guide-detail" aria-label="About this route">
        <article className="guide-detail-card">
          <h2>Commercial jobs</h2>
          <ul>
            {c.jobs.map((job) => (
              <li key={job}>{job}</li>
            ))}
          </ul>
        </article>
        <article className="guide-detail-card">
          <h2>Current availability</h2>
          <dl>
            <dt data-tone="info">Structurally supported</dt>
            <dd>
              Versioned routes and shared mission requirements, supplier offers and actual meeting
              records.
            </dd>
            <dt data-tone="caution">Being piloted</dt>
            <dd>No customer pilot is announced here. Operator validation uses invented records.</dd>
            <dt data-tone="positive">Operationally available</dt>
            <dd>Customer account access and scoped synthetic test journeys.</dd>
            <dt data-tone="unknown">Not yet available</dt>
            <dd>
              Real customer mission admission, verified local coverage, automatic outreach and
              confirmed visit services.
            </dd>
          </dl>
        </article>
        <article className="guide-detail-card">
          <h2>Geography and evidence</h2>
          <p>{c.qualification}</p>
          <p>{c.reverse}</p>
        </article>
      </section>
      <section className="guide-note">
        <p>
          Counterparties and operators are evaluated for an explicitly agreed scope. No supplier
          network, guaranteed buyer or certification is asserted.
        </p>
        <Link prefetch={false} href="/trust" className="text-link">
          How evidence and uncertainty are handled
        </Link>
      </section>
    </PublicShell>
  );
}
