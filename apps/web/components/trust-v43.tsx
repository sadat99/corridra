'use client';

import { FactLabel } from './fact-label';
import { RoutesSection } from './home-more';
import { PlainLimits } from './home-v42-parts';
import { useT } from './language-provider';
import {
  DeepFaq,
  DeepFrame,
  DeepHead,
  DeepHero,
  RelatedLink,
  StartBand,
} from './how-trust-v43-parts';
import { ExampleTag, Eyebrow } from './ux/example-tag';
import { howTrustV43 } from '../content/how-trust-v43';
import { publicPages } from '../content/public-pages';
import { ledgerAmounts, v43 } from '../lib/home-v43-data';
import { fillNodes } from '../lib/i18n/fill';

// /trust with CORRIDRA_UX_HOW_TRUST_V43 on (owner, 26 Nov 2026, first hand to Guardian G66: "yes to all three, build
// it"; mockup docs/revamp/mockups/how-trust-v43/trust.html on branch claude/mockups-how-trust). The page has one job,
// the proof, and shows all of it: the five evidence labels, the history ledger where a correction is a new entry, the
// outcome stages, the route statuses, Plain Limits and the trust questions, then one Start a Request. The labels and
// the ledger are the home's v4.3 words (single source); nothing sits behind Show More.
const content = publicPages['trust']!;
const page = howTrustV43.trust;

const names = [
  ['Self-declared', 'self'],
  ['Evidence available', 'evidence'],
  ['Verified', 'verified'],
  ['Derived', 'derived'],
  ['Outcome observed', 'outcome'],
] as const;

function Labels() {
  return (
    <section className="hv43-band" id="page-approach" aria-labelledby="approach-title">
      <DeepHead
        id="approach-title"
        eyebrow={page.approachEyebrow}
        title={content.introduction.title}
        lead={content.introduction.text}
      />
      <ul className="htv43-cards htv43-cols-5" aria-label="The five evidence labels">
        {content.sections.map((section) => (
          <li key={section.title} className="htv43-card htv43-label-card">
            <FactLabel label={section.tag!} as="h3" />
            <p>{section.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History() {
  const t = useT();
  return (
    <section className="hv43-band htv43-subtle" id="trust" aria-labelledby="trust-title">
      <div className="htv43-split">
        <div className="htv43-lede">
          <Eyebrow>{t('home.tr.tr.eyebrow')}</Eyebrow>
          <h2 id="trust-title">{t('home.tr.tr.title')}</h2>
          <p>{t('home.tr.tr.lead')}</p>
          <ul className="hv43-labels" aria-label={page.legend}>
            {names.map(([label, name]) => (
              <li key={name}>
                <FactLabel label={label} english />
                <span>{t(v43(`trust.line.${name}`))}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="hv43-ledger" role="group" aria-label={t(v43('trust.ledger'))}>
          <div className="hv43-ledger-head">
            <strong>{t(v43('trust.ledger'))}</strong>
            <ExampleTag>{t(v43('ex.sample'))}</ExampleTag>
          </div>
          <div className="htv43-ledger-row">
            <span className="htv43-day">{t(v43('trust.day.1'))}</span>
            <p>{t(v43('trust.d1'))}</p>
            <FactLabel label="Self-declared" english />
          </div>
          <div className="htv43-ledger-row">
            <span className="htv43-day">{t(v43('trust.day.6'))}</span>
            <p>
              {fillNodes(t(v43('trust.d6')), { amount: <b dir="ltr">{ledgerAmounts.original}</b> })}
            </p>
            <FactLabel label="Self-declared" english />
          </div>
          <div className="htv43-ledger-row">
            <span className="htv43-day">{t(v43('trust.d11.summary'))}</span>
            <p>
              {fillNodes(t(v43('trust.d11.text')), {
                amount: <b dir="ltr">{ledgerAmounts.correction}</b>,
              })}
            </p>
            <span className="guide-tag" data-tone="unknown">
              {t(v43('trust.new'))}
            </span>
          </div>
          <p className="htv43-illustrative">{page.illustrative}</p>
        </div>
      </div>
    </section>
  );
}

function Outcomes() {
  const progress = content.progress!;
  return (
    <section className="hv43-band" id="outcomes" aria-labelledby="outcomes-title">
      <header className="hv43-head">
        <div>
          <Eyebrow>{progress.label}</Eyebrow>
          <h2 id="outcomes-title">
            {progress.title.map((line) => (
              <span key={line} className="htv43-line">
                {line}
              </span>
            ))}
          </h2>
        </div>
        <p>{progress.text}</p>
      </header>
      <ol className="htv43-outcomes" aria-label="Eleven commercial events in order">
        {progress.steps.map((step, index) => (
          <li key={step} data-final={index === progress.steps.length - 1}>
            <span aria-hidden="true">{index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Ai() {
  return (
    <section className="hv43-band htv43-selected" id="page-next" aria-labelledby="close-title">
      <div className="htv43-split">
        <div className="htv43-lede">
          <Eyebrow>{page.aiEyebrow}</Eyebrow>
          <h2 id="close-title">{content.closing.title}</h2>
        </div>
        <div className="htv43-lede">
          <p>{content.closing.text}</p>
          <RelatedLink href={content.related.href} label={content.related.label} />
        </div>
      </div>
    </section>
  );
}

export function TrustV43() {
  return (
    <DeepFrame>
      <DeepHero
        content={content}
        action={page.action}
        tocLabel={howTrustV43.tocLabel}
        toc={page.toc}
      />
      <Labels />
      <History />
      <Outcomes />
      <Ai />
      <div className="hv43-band htv43-subtle htv43-routes">
        <RoutesSection flags limits={false} />
      </div>
      <PlainLimits />
      <DeepFaq ids={howTrustV43.faq.trust} />
      <StartBand band={publicPages['how-it-works']!.band!} />
    </DeepFrame>
  );
}
