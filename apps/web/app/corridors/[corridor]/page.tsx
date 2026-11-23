import { PublicShell } from '../../../components/public-shell';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { corridorPages } from '../../../content/corridors';
import { Lines } from '../../../components/public-page';
import { Flagged, placeMark } from '../../../components/ux/flag';
import '../../../components/page-compact.css';
import './corridor.css';
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
      <section className="guide-page-hero guide-page-hero--compact">
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
          {/* UI/UX.v4.1 L1: each place of the route has its mark before its written name; the words are unchanged. */}
          <p className="label guide-corridor-places">
            {c.title.split('\u2013').map((place, index) => (
              <Fragment key={place}>
                {index > 0 ? ' ' : null}
                <Flagged code={index === 0 ? placeMark('BD') : placeMark(c.market)}>
                  {place}
                </Flagged>
              </Fragment>
            ))}
          </p>
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
              Start a Request on This Route
            </Link>
          </div>
        </div>
      </section>
      <section className="guide-detail-open" aria-label="About this route">
        <div className="guide-detail">
          <article className="guide-detail-card">
            <h2>What we help with</h2>
            <ul>
              {c.jobs.map((job) => (
                <li key={job}>{job}</li>
              ))}
            </ul>
          </article>
          <article className="guide-detail-card" id="current-availability">
            <h2>Current availability</h2>
            <dl>
              <dt data-tone="positive">Available now</dt>
              <dd>{c.available}</dd>
              <dt data-tone="info">What happens</dt>
              <dd>
                Send a request and follow it in your account. Our team reviews it and agrees what
                the work covers and a written quote with you. Only then does our team start the
                research and meeting planning.
              </dd>
              <dt data-tone="unknown">Not offered</dt>
              <dd>
                Online payment is switched off. So are automated outreach and AI assistance. We do
                not claim local coverage we have not checked, and a visit counts only once the
                meeting is confirmed.
              </dd>
            </dl>
          </article>
          <article className="guide-detail-card" id="where-the-work-happens">
            <h2>Where the work happens</h2>
            <p>{c.qualification}</p>
            <p>{c.reverse}</p>
          </article>
        </div>
      </section>
      <section className="guide-note">
        <p>
          We check each company against what the work covers, as agreed with you. We do not claim a
          supplier network or certification. We do not guarantee buyers.
        </p>
        <Link prefetch={false} href="/trust" className="text-link">
          How We Label Facts
        </Link>
      </section>
    </PublicShell>
  );
}
