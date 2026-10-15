import { PublicShell } from './public-shell';
import { Arrow } from './arrow';
import Link from 'next/link';
import type { PublicPageContent } from '../content/public-pages';

export function PublicPage({ content }: { content: PublicPageContent }) {
  return (
    <PublicShell>
      <section className="page-hero">
        <nav className="ux-breadcrumb" aria-label="Breadcrumb">
          <Link prefetch={false} className="text-link breadcrumb" href="/">
            Corridra
          </Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">
            {content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())}
          </span>
        </nav>
        <p className="label">{content.label}</p>
        <h1>{content.title}</h1>
        <p className="page-description">{content.description}</p>
        <div className="hero-actions">
          <Link
            prefetch={false}
            className="primary-link"
            href={content.intakeJob ? `/plan?job=${content.intakeJob}` : '/plan'}
          >
            {content.cta ?? 'Mission planning status'}{' '}
            <span aria-hidden="true">
              <Arrow />
            </span>
          </Link>
          <span className="launch-status">
            <span aria-hidden="true" />
            Example requests only
          </span>
        </div>
        {content.route && (
          <p className="ux-route-chip">
            <strong>{content.route.label}</strong>
            <Link prefetch={false} className="text-link" href={content.route.href}>
              {content.route.linkLabel}
            </Link>
          </p>
        )}
      </section>
      <nav className="ux-section-index" aria-label="Page sections">
        <a href="#page-approach">The approach</a>
        <a href="#page-next">Next step</a>
      </nav>
      <section className="editorial-intro" id="page-approach">
        <h2>{content.introduction.title}</h2>
        <p>{content.introduction.text}</p>
      </section>
      <section
        className="detail-section"
        aria-label={
          content.label === 'TRUST & EVIDENCE' ? 'Evidence labels' : 'The planned approach'
        }
      >
        <div className="detail-grid">
          {content.sections.map((section, index) => (
            <article className="detail-card" key={section.title}>
              <span className="label">{String(index + 1).padStart(2, '0')}</span>
              <h2>{section.title}</h2>
              <p>{section.text}</p>
            </article>
          ))}
        </div>
      </section>
      {content.reverse && (
        <section className="ux-reverse" aria-labelledby="reverse-title">
          <div>
            <h2 id="reverse-title">{content.reverse.title}</h2>
            <p>{content.reverse.text}</p>
          </div>
          <div className="ux-reverse-actions">
            <Link prefetch={false} className="button-secondary" href={content.reverse.href}>
              {content.reverse.cta}{' '}
              <span aria-hidden="true">
                <Arrow />
              </span>
            </Link>
            <Link prefetch={false} className="text-link" href={content.reverse.scopeHref}>
              {content.reverse.scopeLabel}
            </Link>
          </div>
        </section>
      )}
      {content.record && (
        <section className="ux-record" aria-labelledby="record-title">
          <h2 id="record-title">{content.record.title}</h2>
          <ul>
            {content.record.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="closing public-closing" id="page-next">
        <p className="label">WHAT TO EXPECT</p>
        <h2>{content.closing.title}</h2>
        <p>{content.closing.text}</p>
        <Link prefetch={false} className="text-link" href={content.related.href}>
          {content.related.label}{' '}
          <span aria-hidden="true">
            <Arrow />
          </span>
        </Link>
      </section>
    </PublicShell>
  );
}
