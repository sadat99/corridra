'use client';

import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';
import { useT } from './language-provider';
import { ExampleTag, Eyebrow } from './ux/example-tag';
import { v43 } from '../lib/home-v43-data';
import { sentences } from '../lib/how-trust-v43';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v4.4 bands (design approved 27 Nov 2026): how it works as one timeline, the evidence as a short ledger of
// ticks, and the worked example as four steps of who does what. Process and evidence use the page's existing words;
// the example is sample data and says so. Nothing here sends anything.
const four = [1, 2, 3, 4] as const;

export function HomeV44Process() {
  const t = useT();
  return (
    <section className="hv43-band hv44-process" id="process" aria-labelledby="process-title">
      <Eyebrow>{t(v43('process.eyebrow'))}</Eyebrow>
      <h2 id="process-title">{t(v43('process.title'))}</h2>
      <ol className="hv44-timeline">
        {four.map((n) => (
          <li key={n}>
            <span className="hv44-step-no">{n}</span>
            <strong>{t(`home.v43.process.step.${n}` as MessageKey)}</strong>
            <span>{t(`home.v43.process.rec.china.${n}.line` as MessageKey)}</span>
          </li>
        ))}
      </ol>
      <Link prefetch={false} className="text-link" href="/how-it-works">
        {t(v43('process.full'))}
      </Link>
    </section>
  );
}

export function HomeV44Trust() {
  const t = useT();
  return (
    <section className="hv43-band hv44-trust" id="trust" aria-labelledby="trust-title">
      <div className="hv44-trust-card">
        <div>
          <Eyebrow>{t(v43('trust.eyebrow'))}</Eyebrow>
          <h2 id="trust-title">{t(v43('trust.title'))}</h2>
          <Link prefetch={false} className="text-link" href="/trust">
            {t(v43('trust.link'))}
          </Link>
        </div>
        <ul className="hv44-ticks">
          {sentences(t(v43('trust.lead'))).map((line) => (
            <li key={line}>
              <CorridraIcon name="check" size={18} />
              {line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function HomeV44Example({ onFull }: { onFull: () => void }) {
  const t = useT();
  return (
    <section className="hv43-band hv44-example" id="example" aria-labelledby="example-title">
      <div className="hv44-example-head">
        <Eyebrow>{t(v43('ex.eyebrow'))}</Eyebrow>
        <ExampleTag>{t(v43('ex.sample'))}</ExampleTag>
      </div>
      <h2 id="example-title" tabIndex={-1}>
        {t('home.v44.eg.title')}
      </h2>
      <p className="hv44-example-lead">{t('home.v44.eg.lead')}</p>
      <ol className="hv44-cards">
        {four.map((n) => {
          const you = n % 2 === 1;
          return (
            <li key={n} className="hv44-card-step">
              <div className="hv44-card-top">
                <span className="hv44-who" data-who={you ? 'you' : 'team'}>
                  {t(you ? 'home.v44.eg.you' : 'home.v44.eg.team')}
                </span>
                <span>{t(`home.v44.eg.${n}.when` as MessageKey)}</span>
              </div>
              <strong>{t(`home.v44.eg.${n}.title` as MessageKey)}</strong>
              <span>{t(`home.v44.eg.${n}.line` as MessageKey)}</span>
            </li>
          );
        })}
      </ol>
      <div className="hv44-example-links">
        <a className="text-link" href="#brief">
          {t(v43('ex.cta'))}
        </a>
        <button type="button" className="text-link" onClick={onFull}>
          {t(v43('ex.full'))}
        </button>
      </div>
    </section>
  );
}
