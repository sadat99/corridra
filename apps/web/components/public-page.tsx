import { PublicShell } from './public-shell';
import { Arrow } from './arrow';
import { FactLabel } from './fact-label';
import Link from 'next/link';
import type { PublicPageContent } from '../content/public-pages';

/** One sentence per line, so a headline never wraps in the middle of a thought. */
export function Lines({ text }: { text: string }) {
  const lines = text.split(/(?<=[.?!])\s+/);
  return (
    <>
      {lines.map((line, index) => (
        <span key={line}>
          {index > 0 && <br />}
          {line}
        </span>
      ))}
    </>
  );
}

function StepItem({
  section,
  number,
}: {
  section: PublicPageContent['sections'][number];
  number: number;
}) {
  return (
    <li>
      <span className="guide-step-number" aria-hidden="true">
        {number}
      </span>
      <h3>{section.title}</h3>
      {section.name && <p className="label guide-step-name">{section.name}</p>}
      <p>{section.text}</p>
    </li>
  );
}

function Steps({ content }: { content: PublicPageContent }) {
  const { sections, groups } = content;
  if (!groups) {
    return (
      <section className="guide-page-steps" aria-label="The approach">
        <div>
          <ol data-count={sections.length}>
            {sections.map((section, index) => (
              <StepItem key={section.title} section={section} number={index + 1} />
            ))}
          </ol>
        </div>
      </section>
    );
  }
  const size = Math.ceil(sections.length / groups.length);
  return (
    <section className="guide-journey" aria-label="The approach">
      {groups.map((title, index) => {
        const start = index * size;
        const items = sections.slice(start, start + size);
        return (
          <div className="guide-phase" key={title}>
            <header>
              <h3>{title}</h3>
              <p>
                Steps {start + 1} to {start + items.length}
              </p>
            </header>
            <ol data-count={items.length}>
              {items.map((section, i) => (
                <StepItem key={section.title} section={section} number={start + i + 1} />
              ))}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

export function PublicPage({ content }: { content: PublicPageContent }) {
  const labelled = content.sections.some((section) => section.tag);
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">
              {content.label.toLowerCase().replace(/^./, (c) => c.toUpperCase())}
            </span>
          </nav>
          <p className="label">{content.label}</p>
          <h1>
            <Lines text={content.title} />
          </h1>
          <p className="guide-lead">{content.description}</p>
          <div className="guide-page-actions">
            <Link
              prefetch={false}
              className="primary-link"
              href={
                content.ctaHref ?? (content.intakeJob ? `/plan?job=${content.intakeJob}` : '/plan')
              }
            >
              {content.cta ?? 'Start a request'}
            </Link>
          </div>
        </div>
        {content.route && (
          <aside className="guide-route" aria-label="Route for this page">
            <p className="label">THE ROUTE THIS PAGE IS ABOUT</p>
            <strong>{content.route.label}</strong>
            <Link prefetch={false} className="text-link" href={content.route.href}>
              {content.route.linkLabel} <Arrow />
            </Link>
          </aside>
        )}
      </section>

      <section className={`guide-page-intro${labelled ? ' is-labelled' : ''}`} id="page-approach">
        <div>
          <h2>{content.introduction.title}</h2>
          <p>{content.introduction.text}</p>
        </div>
        {labelled && (
          <ul aria-label="The five evidence labels">
            {content.sections.map((section) => (
              <li key={section.title}>
                <FactLabel label={section.tag!} as="h3" />
                <p>{section.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!labelled && <Steps content={content} />}

      {content.reverse && (
        <section className="guide-reverse" aria-labelledby="reverse-title">
          <div>
            <h2 id="reverse-title">{content.reverse.title}</h2>
            <p>{content.reverse.text}</p>
          </div>
          <div className="guide-reverse-actions">
            <Link prefetch={false} className="button-secondary" href={content.reverse.href}>
              {content.reverse.cta} <Arrow />
            </Link>
            <Link prefetch={false} className="text-link" href={content.reverse.scopeHref}>
              {content.reverse.scopeLabel}
            </Link>
          </div>
        </section>
      )}

      {content.record && (
        <section className="guide-record" aria-labelledby="record-title">
          <div>
            <p className="label">YOUR RECORD</p>
            <h2 id="record-title">{content.record.title}</h2>
          </div>
          <ul>
            {content.record.items.map((item) => (
              <li key={item}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m5 12 5 5 9-10" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.progress && (
        <section className="guide-progress" aria-labelledby="outcomes-title">
          <p className="label">{content.progress.label}</p>
          <h2 id="outcomes-title">
            <Lines text={content.progress.title.join(' ')} />
          </h2>
          <p className="guide-lead">{content.progress.text}</p>
          <ol className="outcome-path" aria-label="Eleven commercial events in order">
            {content.progress.steps.map((step, index) => (
              <li key={step} data-final={index === content.progress!.steps.length - 1}>
                <span aria-hidden="true">{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      )}

      {content.statements ? (
        <section className="guide-statements" id="page-next" aria-labelledby="close-title">
          <p className="label">WHAT TO EXPECT</p>
          <h2 id="close-title">{content.closing.title}</h2>
          <p className="guide-lead">{content.closing.text}</p>
          <ul>
            {content.statements.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
          <Link prefetch={false} className="text-link" href={content.related.href}>
            {content.related.label} <Arrow />
          </Link>
        </section>
      ) : (
        <section className="guide-band" id="page-next" aria-labelledby="close-title">
          <div>
            <h2 id="close-title">{content.closing.title}</h2>
            <p>{content.closing.text}</p>
          </div>
          <Link prefetch={false} className="primary-link" href={content.related.href}>
            {content.related.label}
          </Link>
        </section>
      )}

      {content.band && (
        <section className="guide-band" aria-labelledby="band-title">
          <div>
            <h2 id="band-title">{content.band.title}</h2>
            <p>{content.band.text}</p>
          </div>
          <Link
            prefetch={false}
            className="primary-link"
            href={
              content.ctaHref ?? (content.intakeJob ? `/plan?job=${content.intakeJob}` : '/plan')
            }
          >
            {content.cta ?? 'Start a request'}
          </Link>
        </section>
      )}
    </PublicShell>
  );
}
