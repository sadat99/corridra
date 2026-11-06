'use client';

import { Arrow } from '../components/arrow';
import { CorridraIcon } from '../components/corridra-icon';
import { FactLabel, type factLabels } from '../components/fact-label';
import { HomeMissionPlayer } from '../components/home-mission-player';
import Link from 'next/link';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';
import '../components/home-landing.css';
import { useT } from '../components/language-provider';
import type { MessageKey } from '../lib/i18n/messages';

// The home page, concept G (owner decision of 6 November 2026: "E with F"). The words are keys in the message
// files (lib/i18n/home-words.ts). They show in the chosen language only while `CORRIDRA_LANGUAGES_PAGES` is on;
// until then every key shows its English words. The five trust names, airport codes and company letters stay as
// written.
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

type Fact = (typeof factLabels)[number]['label'];

// The labels a company record shows. The first three are trust names; the fourth says a fact was asked for and
// not yet answered, so it is a state, not a trust name, and is shown in the reader's words.
const labels: readonly { fact?: Fact; line: MessageKey }[] = [
  { fact: 'Self-declared', line: 'home.fact.selfDeclared' },
  { fact: 'Evidence available', line: 'home.fact.evidence' },
  { fact: 'Verified', line: 'home.fact.verified' },
  { line: 'home.fact.notConfirmed' },
];

// The example record beside the labels: Importer C from the buyer shortlist, with every label on one field.
const dossier: readonly { field: MessageKey; fact?: Fact }[] = [
  { field: 'home.dossier.registration', fact: 'Verified' },
  { field: 'home.dossier.privateLabel', fact: 'Self-declared' },
  { field: 'home.dossier.priceList', fact: 'Evidence available' },
  { field: 'home.dossier.volume' },
];

// Boarding passes for the two spotlighted routes and the way to any other. Airport codes are the same in
// every language.
const passes = [
  {
    href: '/corridors/bangladesh-china',
    tag: 'home.route.tag',
    number: '01',
    to: 'CAN',
    text: 'home.pass.bdcn',
    stub: 'home.pass.open',
  },
  {
    href: '/corridors/bangladesh-spain',
    tag: 'home.route.tag',
    number: '02',
    to: 'MAD',
    text: 'home.pass.bdes',
    stub: 'home.pass.open',
  },
  {
    href: '/corridors',
    tag: 'home.other.title',
    to: '???',
    text: 'home.other.text',
    stub: 'home.other.link',
  },
] as const satisfies readonly {
  href: string;
  tag: MessageKey;
  number?: string;
  to: string;
  text: MessageKey;
  stub: MessageKey;
}[];

function NotConfirmed() {
  const t = useT();
  return (
    <span className="guide-tag" data-tone="unknown">
      <CorridraIcon name="help" />
      {t('home.value.notConfirmed')}
    </span>
  );
}

export default function Home() {
  const t = useT();
  return (
    <PublicShell className="ux-guide-home ac1-home" translated>
      <LegacyHashRedirect />
      <section className="ac1-hero" aria-labelledby="home-title">
        <div className="ac1-hero-copy">
          <p className="label ac1-rule">{t('home.eyebrow')}</p>
          <h1 id="home-title">{t('home.title')}</h1>
          <p className="ac1-lead">{t('home.lead.watch')}</p>
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
        </div>
        <HomeMissionPlayer />
      </section>

      <section className="ac1-section ac1-facts" aria-labelledby="facts-title">
        <div className="ac1-facts-copy">
          <p className="label ac1-rule">{t('home.facts.eyebrow')}</p>
          <p className="ac1-hook">{t('home.facts.hook')}</p>
          <h2 id="facts-title">{t('home.facts.title')}</h2>
          <ol className="ac1-truth">
            {labels.map(({ fact, line }, index) => (
              <li key={line}>
                <span className="ac1-truth-number" aria-hidden="true">
                  {index + 1}
                </span>
                {fact ? <FactLabel label={fact} english /> : <NotConfirmed />}
                <span>{t(line)}</span>
              </li>
            ))}
          </ol>
          <Link prefetch={false} className="ac1-quiet" href="/trust">
            {t('home.facts.more')} <Arrow />
          </Link>
        </div>
        <div className="ac1-dossier">
          <figure className="ac1-dossier-card">
            <figcaption>
              <span>{t('home.dossier.list')}</span>
              <span className="ac1-example-tag">{t('home.example')}</span>
            </figcaption>
            <h3>{t('home.buyer.c.name')}</h3>
            <p className="ac1-dossier-sub">{t('home.dossier.sub')}</p>
            <ul className="ac1-evidence">
              {dossier.map(({ field, fact }) => (
                <li key={field}>
                  <span>{t(field)}</span>
                  {fact ? <FactLabel label={fact} english /> : <NotConfirmed />}
                </li>
              ))}
            </ul>
            <p className="ac1-stamp">{t('home.buyer.c.state')}</p>
          </figure>
        </div>
      </section>

      <section className="ac1-section" aria-labelledby="routes-title">
        <p className="label ac1-rule">{t('home.routes.eyebrow')}</p>
        <h2 id="routes-title">{t('home.routes.title')}</h2>
        <p className="ac1-section-note">{t('home.routes.lead')}</p>
        <div className="ac1-routes">
          {passes.map((pass) => (
            <Link
              prefetch={false}
              key={pass.href}
              href={pass.href}
              className={pass.href === '/corridors' ? 'ac1-pass ac1-other' : 'ac1-pass'}
            >
              <span className="ac1-pass-main">
                <span className="label ac1-route-tag">
                  {t(pass.tag)}
                  {'number' in pass ? ` ${pass.number}` : null}
                </span>
                <span className="ac1-pass-codes" lang="en" aria-hidden="true">
                  DAC <CorridraIcon name="arrow" className="ac1-route-arrow" /> {pass.to}
                </span>
                <span className="ac1-pass-text">{t(pass.text)}</span>
              </span>
              <span className="ac1-pass-stub">{t(pass.stub)}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="guide-band ac1-band" aria-labelledby="close-title">
        <div>
          <h2 id="close-title">{t('home.close.title')}</h2>
          <p>{t('home.close.text')}</p>
        </div>
        <Link prefetch={false} className="primary-link" href="/plan">
          {t('home.start')}
        </Link>
      </section>
    </PublicShell>
  );
}
