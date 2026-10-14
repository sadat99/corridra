import { PublicShell } from '../../../components/public-shell';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { corridorPages } from '../../../content/corridors';
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
      <section className="page-hero">
        <Link href="/corridors" className="text-link breadcrumb">
          Commercial corridors /
        </Link>
        <p className="label">{c.title}</p>
        <h1>{c.heading}</h1>
        <p className="page-description">{c.description}</p>
        <Link className="primary-link" href={`/plan?companyCountry=BD&marketCode=${c.market}`}>
          Prepare a test mission brief
        </Link>
      </section>
      <section className="detail-section">
        <div className="detail-grid">
          <article className="detail-card">
            <h2>Commercial jobs</h2>
            <ul>
              {c.jobs.map((job) => (
                <li key={job}>{job}</li>
              ))}
            </ul>
          </article>
          <article className="detail-card">
            <h2>Current availability</h2>
            <dl>
              <dt>Structurally supported</dt>
              <dd>
                Versioned routes and shared mission requirements, supplier offers and actual meeting
                records.
              </dd>
              <dt>Being piloted</dt>
              <dd>
                No customer pilot is announced here. Operator validation uses invented records.
              </dd>
              <dt>Operationally available</dt>
              <dd>Customer account access and scoped synthetic test journeys.</dd>
              <dt>Not yet available</dt>
              <dd>
                Real customer mission admission, verified local coverage, automatic outreach and
                confirmed visit services.
              </dd>
            </dl>
          </article>
          <article className="detail-card">
            <h2>Geography and evidence</h2>
            <p>{c.qualification}</p>
            <p>{c.reverse}</p>
          </article>
        </div>
        <p>
          Counterparties and operators are evaluated for an explicitly agreed scope. No supplier
          network, guaranteed buyer or certification is asserted.
        </p>
        <Link href="/trust" className="text-link">
          How evidence and uncertainty are handled
        </Link>
      </section>
    </PublicShell>
  );
}
