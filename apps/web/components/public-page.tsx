import { Arrow } from './arrow';
import Link from 'next/link';
import type { PublicPageContent } from '../content/public-pages';

export function PublicPage({ content }: { content: PublicPageContent }) {
  return (
    <main id="main" tabIndex={-1}>
      <section className="page-hero">
        <Link prefetch={false} className="text-link breadcrumb" href="/">
          Corridra /
        </Link>
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
            Coming soon
          </span>
        </div>
      </section>
      <section className="editorial-intro">
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
      <section className="closing public-closing">
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
    </main>
  );
}
