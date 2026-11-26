'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Arrow } from './arrow';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import type { PublicPageContent } from '../content/public-pages';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import { sentences } from '../lib/how-trust-v43';
import './home-v42.css';
import './home-v43.css';
import './home-v43-more.css';
import './how-trust-v43.css';

// Pieces both deep pages share in the one-job-per-page layout (owner, 26 Nov 2026, first hand to Guardian G66: "yes to
// all three, build it"). They sit in the home's v4.3 look (the `hv43` bands and their tokens) and read their words from
// the existing keys; nothing here is written twice.
export const key = (name: string) => name as HomeRoutesKey;

/** One sentence per line, so a headline never wraps in the middle of a thought. */
function Lines({ text }: { text: string }) {
  return (
    <>
      {sentences(text).map((line) => (
        <span key={line} className="htv43-line">
          {line}
        </span>
      ))}
    </>
  );
}

/** The page frame: the home's own classes, so the shipped v4.3 bands and tiles look as they do on the home. */
export function DeepFrame({ children }: { children: ReactNode }) {
  return <div className="hv42 hv43 htv43">{children}</div>;
}

/** Breadcrumb, eyebrow, the title one sentence a line, the lead, one text action and the "On this page" list. No Start a Request. */
export function DeepHero({
  content,
  action,
  tocLabel,
  toc,
}: {
  content: PublicPageContent;
  action: { href: string; label: string };
  tocLabel: string;
  toc: readonly { href: string; label: string }[];
}) {
  return (
    <section className="hv43-band htv43-hero" id="top" aria-labelledby="page-title">
      <div className="htv43-hero-grid">
        <div className="htv43-hero-text">
          <nav className="htv43-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{content.label}</span>
          </nav>
          <Eyebrow>{content.label}</Eyebrow>
          <h1 id="page-title">
            <Lines text={content.title} />
          </h1>
          <p className="htv43-lead">{content.description}</p>
          <div className="htv43-actions">
            <a className="text-link" href={action.href}>
              {action.label}
            </a>
          </div>
        </div>
        <nav className="htv43-toc" aria-label={tocLabel}>
          <p className="label">{tocLabel}</p>
          <ol>
            {toc.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ol>
        </nav>
      </div>
    </section>
  );
}

/** A band's eyebrow and title on the start, its lead on the end from 48 rem. */
export function DeepHead({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lead?: string;
}) {
  return (
    <header className="hv43-head">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id}>{title}</h2>
      </div>
      {lead ? <p>{lead}</p> : null}
    </header>
  );
}

/** The closing question: the one Start a Request of the page, in the words of the page's closing band. */
export function StartBand({ band }: { band: NonNullable<PublicPageContent['band']> }) {
  return (
    <section
      className="hv43-band htv43-selected htv43-start"
      id="start-request"
      aria-labelledby="band-title"
    >
      <div className="htv43-start-grid">
        <div>
          <h2 id="band-title">{band.title}</h2>
          <p>{band.text}</p>
        </div>
        <Link prefetch={false} className="primary-link" href="/plan">
          Start a Request
        </Link>
      </div>
    </section>
  );
}

/** The long questions of the live pages (home.tr.fq.*), each closed on load; the page is given the numbers it holds. */
export function DeepFaq({ ids, subtle = false }: { ids: readonly number[]; subtle?: boolean }) {
  const t = useT();
  return (
    <section
      className={`hv43-band hv43-faq htv43-faq${subtle ? ' htv43-subtle' : ''}`}
      id="faq"
      aria-labelledby="faq-title"
    >
      <DeepHead id="faq-title" eyebrow={t('home.tr.fq.eyebrow')} title={t('home.tr.fq.title')} />
      <div className="hv43-faq-list htv43-faq-list">
        {ids.map((n) => (
          <details key={n}>
            <summary>{t(key(`home.tr.fq.${n}.q`))}</summary>
            <div className="htv43-answer">
              <p>{t(key(`home.tr.fq.${n}.a1`))}</p>
              {n === 2 || n === 6 ? (
                <ul>
                  {(n === 2 ? [1, 2, 3] : [1, 2, 3, 4, 5]).map((l) => (
                    <li key={l}>{t(key(`home.tr.fq.${n}.l${l}`))}</li>
                  ))}
                </ul>
              ) : null}
              {n === 1 || n === 2 || n === 3 || n === 6 ? (
                <p>{t(key(`home.tr.fq.${n}.a2`))}</p>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/** A text link with the shipped arrow, as the live pages draw their related link. */
export function RelatedLink({ href, label }: { href: string; label: string }) {
  return (
    <Link prefetch={false} className="text-link" href={href}>
      {label} <Arrow />
    </Link>
  );
}
