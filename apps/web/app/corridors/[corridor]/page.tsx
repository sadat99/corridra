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
              Start a request on this route
            </Link>
          </div>
        </div>
      </section>
      <section className="guide-detail" aria-label="About this route">
        <article className="guide-detail-card">
          <h2>What we help with</h2>
          <ul>
            {c.jobs.map((job) => (
              <li key={job}>{job}</li>
            ))}
          </ul>
        </article>
        <article className="guide-detail-card">
          <h2>Current availability</h2>
          <dl>
            <dt data-tone="positive">Available now</dt>
            <dd>{c.available}</dd>
            <dt data-tone="info">What happens</dt>
            <dd>
              Send a request and follow it in your account. Our team reviews it, agrees the scope
              and a written quote with you, and only then starts the research and meeting planning.
            </dd>
            <dt data-tone="unknown">Not offered</dt>
            <dd>
              Online payment, automated outreach and AI assistance are switched off. We do not claim
              local coverage we have not checked, and a visit counts only once the meeting is
              confirmed.
            </dd>
          </dl>
        </article>
        <article className="guide-detail-card">
          <h2>Where the work happens</h2>
          <p>{c.qualification}</p>
          <p>{c.reverse}</p>
        </article>
      </section>
      <section className="guide-note">
        <p>
          We check each company against the scope you agree. We do not claim a supplier network,
          guaranteed buyers or certification.
        </p>
        <Link prefetch={false} href="/trust" className="text-link">
          How evidence and uncertainty are handled
        </Link>
      </section>
    </PublicShell>
  );
}
