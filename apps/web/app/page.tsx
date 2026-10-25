'use client';

import { Arrow } from '../components/arrow';
import { CorridraIcon } from '../components/corridra-icon';
import { FactLabel, factLabels } from '../components/fact-label';
import { HomeExampleRecord } from '../components/home-example-record';
import Link from 'next/link';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';
import { useT } from '../components/language-provider';
import type { MessageKey } from '../lib/i18n/messages';

// The words on this page are keys in the message files (lib/i18n/home-words.ts). They show in the chosen language
// only while `CORRIDRA_LANGUAGES_PAGES` is on; until then every key shows its English words, so the page reads as
// it always has. The five trust names, company examples' letters, prices and delivery codes stay as written.
const starts = [
  {
    href: '/plan?job=buyers',
    title: 'home.start.sell.title',
    text: 'home.start.sell.text',
    name: 'home.start.sell.name',
    icon: 'sell',
  },
  {
    href: '/plan?job=sourcing',
    title: 'home.start.buy.title',
    text: 'home.start.buy.text',
    name: 'home.start.buy.name',
    icon: 'buy',
  },
  {
    href: '/plan?job=delegations',
    title: 'home.start.trip.title',
    text: 'home.start.trip.text',
    name: 'home.start.trip.name',
    icon: 'trip',
  },
] as const satisfies readonly {
  href: string;
  title: MessageKey;
  text: MessageKey;
  name: MessageKey;
  icon: string;
}[];

const steps = [
  ['home.step.say.title', 'home.step.say.text'],
  ['home.step.find.title', 'home.step.find.text'],
  ['home.step.review.title', 'home.step.review.text'],
  ['home.step.meet.title', 'home.step.meet.text'],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

const buyers = [
  ['home.buyer.a.name', 'home.buyer.a.note', 'Evidence available', 'home.buyer.a.state'],
  ['home.buyer.b.name', 'home.buyer.b.note', 'Self-declared', 'home.buyer.b.state'],
  ['home.buyer.c.name', 'home.buyer.c.note', 'Verified', 'home.buyer.c.state'],
  ['home.buyer.d.name', 'home.buyer.d.note', 'Self-declared', 'home.buyer.d.state'],
] as const;

const suppliers = ['home.supplier.a', 'home.supplier.b', 'home.supplier.c'] as const;

/** A table cell is either a message key or text that is the same in every language (an amount or a delivery code). */
type Cell = { key: MessageKey } | { text: string };
const quotes: readonly {
  term: MessageKey;
  note?: MessageKey;
  values: readonly (readonly [Cell, 'num' | 'ok' | 'miss' | 'bad'])[];
}[] = [
  {
    term: 'home.term.price',
    values: [
      [{ text: 'USD 42,000' }, 'num'],
      [{ text: 'USD 38,500' }, 'num'],
      [{ text: 'USD 45,700' }, 'num'],
    ],
  },
  {
    term: 'home.term.delivery',
    note: 'home.term.delivery.note',
    values: [
      [{ text: 'FOB Ningbo' }, 'num'],
      [{ key: 'home.value.notStated' }, 'miss'],
      [{ text: 'CIF Chattogram' }, 'num'],
    ],
  },
  {
    term: 'home.term.install',
    values: [
      [{ key: 'home.value.included' }, 'ok'],
      [{ key: 'home.value.notIncluded' }, 'bad'],
      [{ key: 'home.value.notConfirmed' }, 'miss'],
    ],
  },
  {
    term: 'home.term.lead',
    values: [
      [{ key: 'home.value.days90' }, 'num'],
      [{ key: 'home.value.days75' }, 'num'],
      [{ key: 'home.value.days120' }, 'num'],
    ],
  },
];

const factLines: Record<(typeof factLabels)[number]['label'], MessageKey> = {
  'Self-declared': 'home.fact.selfDeclared',
  'Evidence available': 'home.fact.evidence',
  Verified: 'home.fact.verified',
  Derived: 'home.fact.derived',
  'Outcome observed': 'home.fact.outcome',
};

const routes = [
  {
    href: '/corridors/bangladesh-china',
    from: 'home.country.bd',
    to: 'home.country.cn',
    text: 'home.route.bdcn.text',
  },
  {
    href: '/corridors/bangladesh-spain',
    from: 'home.country.bd',
    to: 'home.country.esEu',
    text: 'home.route.bdes.text',
  },
] as const satisfies readonly {
  href: string;
  from: MessageKey;
  to: MessageKey;
  text: MessageKey;
}[];

export default function Home() {
  const t = useT();
  return (
    <PublicShell className="ux-guide-home ac1-home" translated>
      <LegacyHashRedirect />
      <section className="ac1-hero" aria-labelledby="home-title">
        <div className="ac1-hero-copy">
          <p className="label ac1-rule">{t('home.eyebrow')}</p>
          <h1 id="home-title">{t('home.title')}</h1>
          <p className="ac1-lead">{t('home.lead')}</p>
          <nav className="ac1-jobs" aria-label={t('home.jobs.aria')}>
            {starts.map((start) => (
              <Link prefetch={false} key={start.href} href={start.href}>
                <CorridraIcon name={start.icon} className="ac1-job-icon" />
                <span>
                  <strong>{t(start.title)}</strong>
                  <span className="ac1-job-text">{t(start.text)}</span>
                  <span className="label ac1-job-name">{t(start.name)}</span>
                </span>
                <CorridraIcon name="arrow" className="ac1-job-go" />
              </Link>
            ))}
          </nav>
          <Link prefetch={false} className="ac1-quiet" href="/plan">
            {t('home.else')} <Arrow />
          </Link>
          <ul className="ac1-calm">
            <li>
              <CorridraIcon name="check" size={16} />
              {t('home.calm.account')}
            </li>
            <li>
              <CorridraIcon name="check" size={16} />
              {t('home.calm.check')}
            </li>
          </ul>
          <p className="ac1-note">{t('home.note')}</p>
        </div>
        <HomeExampleRecord />
      </section>

      <section className="ac1-section" aria-labelledby="steps-title">
        <p className="label ac1-rule">{t('home.how')}</p>
        <h2 id="steps-title">{t('home.steps.title')}</h2>
        <p className="ac1-lead">{t('home.steps.lead')}</p>
        <ol className="ac1-steps" aria-label={t('home.steps.aria')}>
          {steps.map(([title, text], index) => (
            <li key={title}>
              <span className="ac1-step-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3>{t(title)}</h3>
              <p>{t(text)}</p>
            </li>
          ))}
        </ol>
        <Link prefetch={false} className="ac1-quiet" href="/how-it-works">
          {t('home.steps.more')} <Arrow />
        </Link>
      </section>

      <section className="ac1-section" aria-labelledby="proof-title">
        <p className="label ac1-rule">{t('home.example')}</p>
        <h2 id="proof-title">{t('home.proof.title')}</h2>
        <p className="ac1-lead">{t('home.proof.lead')}</p>
        <div className="ac1-proofs" role="region" aria-label={t('home.proof.aria')} tabIndex={0}>
          <div className="ac1-proof">
            <div>
              <h3 className="ac1-proof-title">
                <CorridraIcon name="sell" /> {t('home.buyers.title')}
              </h3>
              <p>{t('home.buyers.text')}</p>
            </div>
            <div className="ac1-exhibit">
              <p className="ac1-exhibit-head">
                <span className="ac1-example-tag">{t('home.example')}</span>
                <span>{t('home.exhibit.companies')}</span>
              </p>
              <p className="ac1-ledger-head" aria-hidden="true">
                <span>{t('home.ledger.company')}</span>
                <span>{t('home.ledger.why')}</span>
                <span>{t('home.ledger.trust')}</span>
                <span>{t('home.ledger.next')}</span>
              </p>
              <ul className="ac1-buyers" aria-label={t('home.buyers.aria')}>
                {buyers.map(([name, note, fact, state]) => (
                  <li key={name}>
                    <strong>{t(name)}</strong>
                    <span>{t(note)}</span>
                    <FactLabel label={fact} english />
                    <span className="ac1-state">{t(state)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="ac1-proof">
            <div>
              <h3 className="ac1-proof-title">
                <CorridraIcon name="buy" /> {t('home.quotes.title')}
              </h3>
              <p>{t('home.quotes.text')}</p>
            </div>
            <div className="ac1-exhibit">
              <p className="ac1-exhibit-head">
                <span className="ac1-example-tag">{t('home.example')}</span>
                <span>{t('home.exhibit.suppliers')}</span>
              </p>
              <div className="ac1-compare" role="table" aria-label={t('home.quotes.aria')}>
                <div className="ac1-compare-row ac1-compare-head" role="row">
                  <span role="columnheader">{t('home.quotes.term')}</span>
                  {suppliers.map((supplier) => (
                    <span role="columnheader" key={supplier}>
                      {t(supplier)}
                    </span>
                  ))}
                </div>
                {quotes.map((quote) => (
                  <div className="ac1-compare-row" role="row" key={quote.term}>
                    <span role="rowheader">
                      {t(quote.term)}
                      {quote.note ? <small>{t(quote.note)}</small> : null}
                    </span>
                    {quote.values.map(([cell, tone], index) => (
                      <span
                        role="cell"
                        key={suppliers[index]}
                        data-supplier={t(suppliers[index])}
                        data-tone={tone}
                      >
                        {'key' in cell ? (
                          t(cell.key)
                        ) : (
                          // An amount or a delivery code is written the same in every language.
                          <span lang="en" dir="ltr">
                            {cell.text}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ac1-section" aria-labelledby="facts-title">
        <p className="label ac1-rule">{t('home.facts.eyebrow')}</p>
        <h2 id="facts-title">{t('home.facts.title')}</h2>
        <p className="ac1-lead">{t('home.facts.lead')}</p>
        <ul className="ac1-truth">
          {factLabels.map((fact) => (
            <li key={fact.label}>
              <FactLabel label={fact.label} english />
              <span>{t(factLines[fact.label])}</span>
            </li>
          ))}
        </ul>
        <Link prefetch={false} className="ac1-quiet" href="/trust">
          {t('home.facts.more')} <Arrow />
        </Link>
      </section>

      <section className="ac1-section" aria-labelledby="routes-title">
        <p className="label ac1-rule">{t('home.routes.eyebrow')}</p>
        <h2 id="routes-title">{t('home.routes.title')}</h2>
        <p className="ac1-lead">{t('home.routes.lead')}</p>
        <div className="ac1-routes">
          {routes.map((route, index) => (
            <article key={route.href}>
              <p className="ac1-route-tag">
                {t('home.route.tag')} {String(index + 1).padStart(2, '0')}
              </p>
              <h3>
                {t(route.from)} <CorridraIcon name="arrow" className="ac1-route-arrow" />{' '}
                {t(route.to)}
              </h3>
              <p>{t(route.text)}</p>
              <Link prefetch={false} className="ac1-quiet" href={route.href}>
                {t('home.route.more')} <Arrow />
              </Link>
            </article>
          ))}
          <div className="ac1-other">
            <p className="ac1-route-tag">{t('home.other.tag')}</p>
            <h3>{t('home.other.title')}</h3>
            <p>{t('home.other.text')}</p>
            <Link prefetch={false} className="button-secondary" href="/corridors">
              {t('home.other.link')}
            </Link>
          </div>
        </div>
      </section>

      <section className="guide-band ac1-band" aria-label={t('home.start')}>
        <div>
          <h2>{t('home.band.title')}</h2>
          <p>{t('home.band.text')}</p>
        </div>
        <Link prefetch={false} className="primary-link" href="/plan">
          {t('home.start')}
        </Link>
      </section>
    </PublicShell>
  );
}
