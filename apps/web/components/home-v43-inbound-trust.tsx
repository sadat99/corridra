'use client';

import Link from 'next/link';
import { FactLabel } from './fact-label';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { ExampleTag, Eyebrow } from './ux/example-tag';
import { ledgerAmounts, v43 } from '../lib/home-v43-data';
import { fillNodes } from '../lib/i18n/fill';

// Home page v4.3 "Into Bangladesh" band and "Evidence and records". The five trust names are the shipped English
// labels in every language; the ledger is the one commercial record of the page (a correction is a new entry and
// revision 1 stays visible), tagged as sample data.
export function HomeV43Inbound({ onInbound }: { onInbound: () => void }) {
  const t = useT();
  return (
    <section className="hv43-band hv43-inbound" id="inbound" aria-labelledby="inbound-title">
      <div className="hv43-inbound-grid">
        <div>
          <Eyebrow>
            <PlaceWords text={t(v43('inbound.eyebrow'))} />
          </Eyebrow>
          <h2 id="inbound-title">
            <PlaceWords text={t(v43('inbound.title'))} />
          </h2>
        </div>
        <div className="hv43-inbound-text">
          <p>{t(v43('inbound.text'))}</p>
          <button type="button" className="text-link" onClick={onInbound}>
            {t(v43('inbound.go'))}
          </button>
        </div>
      </div>
    </section>
  );
}

const labels = [
  ['Self-declared', 'self'],
  ['Evidence available', 'evidence'],
  ['Verified', 'verified'],
  ['Derived', 'derived'],
  ['Outcome observed', 'outcome'],
] as const;

export function HomeV43Trust() {
  const t = useT();
  const original = <b dir="ltr">{ledgerAmounts.original}</b>;
  return (
    <section className="hv43-band hv43-trust" id="trust" aria-labelledby="trust-title">
      <header className="hv43-head">
        <div>
          <Eyebrow>{t(v43('trust.eyebrow'))}</Eyebrow>
          <h2 id="trust-title">{t(v43('trust.title'))}</h2>
        </div>
        <p>{t(v43('trust.lead'))}</p>
      </header>
      <div className="hv43-trust-grid">
        <ul className="hv43-labels">
          {labels.map(([label, name]) => (
            <li key={name}>
              <FactLabel label={label} english />
              <span>{t(v43(`trust.line.${name}`))}</span>
            </li>
          ))}
        </ul>
        <div className="hv43-ledger" role="group" aria-label={t(v43('trust.ledger'))}>
          <div className="hv43-ledger-head">
            <strong>{t(v43('trust.ledger'))}</strong>
            <ExampleTag>{t(v43('ex.sample'))}</ExampleTag>
          </div>
          <p className="hv43-ledger-row">
            <span>{t(v43('trust.day.1'))}</span> {t(v43('trust.d1'))}
          </p>
          <p className="hv43-ledger-row">
            <span>{t(v43('trust.day.6'))}</span>{' '}
            {fillNodes(t(v43('trust.d6')), { amount: original })}
          </p>
          <details className="hv43-correction">
            <summary>{t(v43('trust.d11.summary'))}</summary>
            <p>
              {fillNodes(t(v43('trust.d11.text')), {
                amount: <b dir="ltr">{ledgerAmounts.correction}</b>,
              })}{' '}
              <span className="guide-tag" data-tone="unknown">
                {t(v43('trust.new'))}
              </span>
            </p>
          </details>
        </div>
      </div>
      <Link prefetch={false} className="text-link" href="/trust">
        {t(v43('trust.link'))}
      </Link>
    </section>
  );
}
