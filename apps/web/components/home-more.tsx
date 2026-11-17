'use client';

import Link from 'next/link';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Arrow } from './arrow';
import { FactLabel } from './fact-label';
import { useT } from './language-provider';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import { goalLinks } from '../lib/home-routes-data';
import '../app/comfort.css';
import './home-landing.css';
import './home-routes.css';

// Sections that left the home page on 17 November 2026 so it fits its length budget (owner: "go ahead with the
// height"; Guardian 24): the words are kept as they were. The mission line, the way in by goal, the eight people and
// the questions sit on /how-it-works; the five trust labels and the history ledger on /trust; the route statuses and
// what Corridra is not on /corridors. Each is wrapped in the home's own classes, so it looks as it did.
const key = (name: string) => name as HomeRoutesKey;

export function HomeMissionMore() {
  const t = useT();
  return (
    <div className="ac1-home tr-home tr-more-sections">
      <section className="tr-section" id="how" aria-labelledby="how-title">
        <p className="label ac1-rule">{t('home.tr.ms.eyebrow')}</p>
        <h2 id="how-title">{t('home.tr.ms.title')}</h2>
        <p className="tr-sub">{t('home.tr.ms.lead')}</p>
        <ol className="tr-track" aria-label={t('home.tr.ms.list')}>
          {Array.from({ length: 14 }, (_, i) => (
            <li key={i} className={i >= 7 && i <= 12 ? 'is-optional' : undefined}>
              <span className="tr-track-dot" aria-hidden="true" />
              {t(key(`home.tr.ms.s${i}`))}
              {i >= 7 && i <= 12 ? (
                <span className="sr-only"> ({t('home.tr.ms.optional')})</span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="tr-small">{t('home.tr.ms.note')}</p>
        <div className="tr-nevers">
          {[1, 2, 3, 4].map((n) => (
            <div key={n}>
              <strong>{t(key(`home.tr.nv.${n}`))}</strong>
              <span>{t(key(`home.tr.nv.${n}.text`))}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="tr-section tr-alt" id="start" aria-labelledby="start-title">
        <p className="label ac1-rule">{t('home.tr.br.eyebrow')}</p>
        <h2 id="start-title">{t('home.tr.br.title')}</h2>
        <p className="tr-sub">{t('home.tr.br.lead')}</p>
        <nav className="tr-goals" aria-label={t('home.tr.br.goals')}>
          {goalLinks.map((goal) => (
            <Link prefetch={false} key={goal.key} href={goal.href}>
              {t(goal.label)}
              <Arrow />
            </Link>
          ))}
        </nav>
        <p className="tr-small">
          <strong>{t('home.tr.br.next')}.</strong> {t('home.tr.br.next.text')}
        </p>
      </section>

      <People />
    </div>
  );
}

// The questions are their own piece because their <details> must not sit inside the Show More disclosure (a page's
// Show More is the only disclosure the layout tests count there); PublicPage shows them right after it opens.
export function HomeFaqMore() {
  const t = useT();
  return (
    <div className="ac1-home tr-home tr-more-sections">
      <section className="tr-section tr-alt" id="faq" aria-labelledby="faq-title">
        <p className="label ac1-rule">{t('home.tr.fq.eyebrow')}</p>
        <h2 id="faq-title">{t('home.tr.fq.title')}</h2>
        <div className="tr-faq">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <details key={n}>
              <summary>{t(key(`home.tr.fq.${n}.q`))}</summary>
              <div>
                <p>{t(key(`home.tr.fq.${n}.a1`))}</p>
                {n === 2 ? (
                  <ul>
                    {[1, 2, 3].map((l) => (
                      <li key={l}>{t(key(`home.tr.fq.2.l${l}`))}</li>
                    ))}
                  </ul>
                ) : null}
                {n === 6 ? (
                  <ul>
                    {[1, 2, 3, 4, 5].map((l) => (
                      <li key={l}>{t(key(`home.tr.fq.6.l${l}`))}</li>
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
    </div>
  );
}

export function HomeTrustMore() {
  const t = useT();
  return (
    <div className="ac1-home tr-home tr-more-sections">
      <section className="tr-section tr-navy" id="trust" aria-labelledby="trust-title">
        <p className="label ac1-rule">{t('home.tr.tr.eyebrow')}</p>
        <h2 id="trust-title">{t('home.tr.tr.title')}</h2>
        <p className="tr-sub">{t('home.tr.tr.lead')}</p>
        <ul className="tr-five">
          {(
            [
              ['Self-declared', 'home.fact.selfDeclared'],
              ['Evidence available', 'home.fact.evidence'],
              ['Verified', 'home.fact.verified'],
              ['Derived', 'home.tr.tr.derived'],
              ['Outcome observed', 'home.tr.tr.outcome'],
            ] as const
          ).map(([label, line]) => (
            <li key={label}>
              <FactLabel label={label} english />
              <p>{t(line)}</p>
            </li>
          ))}
        </ul>
        <div className="tr-ledger" role="group" aria-label={t('home.tr.tr.ledger')}>
          <div className="tr-ledger-head">
            <span>{t('home.tr.tr.ledger.title')}</span>
            <span className="ac1-example-tag">{t('home.tr.q.example')}</span>
          </div>
          <div className="tr-ledger-row">
            <span className="tr-day-no">{t('home.tr.tr.day1')}</span>
            <p>{t('home.tr.tr.day1.text')}</p>
            <FactLabel label="Self-declared" english />
          </div>
          <div className="tr-ledger-row">
            <span className="tr-day-no">{t('home.tr.tr.day6')}</span>
            <p>{t('home.tr.tr.day6.text')}</p>
            <FactLabel label="Self-declared" english />
          </div>
          <div className="tr-ledger-row">
            <span className="tr-day-no">{t('home.tr.tr.day11')}</span>
            <p>
              {t('home.tr.tr.day11.text')} <s>{t('home.tr.tr.day11.kept')}</s>
            </p>
            <span className="guide-tag" data-tone="unknown">
              {t('home.tr.tr.newEntry')}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

export function HomeRoutesMore() {
  const t = useT();
  return (
    <div className="ac1-home tr-home tr-more-sections">
      <section className="tr-section" id="routes" aria-labelledby="routes-title">
        <p className="label ac1-rule">{t('home.tr.rs.eyebrow')}</p>
        <h2 id="routes-title">{t('home.tr.rs.title')}</h2>
        <div className="tr-routes">
          <div>
            <strong>{t('home.tr.door.china.route')}</strong>
            <span className="tr-status is-open">{t('home.tr.rs.open')}</span>
            <p>{t('home.tr.rs.china.text')}</p>
            <Link prefetch={false} className="ac1-quiet" href="/corridors/bangladesh-china">
              {t('home.tr.rs.page.china')} <Arrow />
            </Link>
          </div>
          <div>
            <strong>{t('home.tr.door.sell.route')}</strong>
            <span className="tr-status is-open">{t('home.tr.rs.open')}</span>
            <p>{t('home.tr.rs.sell.text')}</p>
            <Link prefetch={false} className="ac1-quiet" href="/corridors/bangladesh-eu">
              {t('home.tr.rs.page.eu')} <Arrow />
            </Link>
          </div>
          <div>
            <strong>{t('home.tr.rs.rev')}</strong>
            <span className="tr-status">{t('home.tr.rs.selective')}</span>
            <p>{t('home.tr.rs.rev.text')}</p>
          </div>
          <div>
            <strong>{t('home.tr.rs.other')}</strong>
            <span className="tr-status is-ask">{t('home.tr.rs.ask')}</span>
            <p className="tr-small">{t('home.tr.rs.other.sub')}</p>
            <p>{t('home.tr.rs.other.text')}</p>
          </div>
        </div>
        <div className="tr-ready">
          <p>{t('home.tr.rs.ready')}</p>
          <ul>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <li key={n} className="tr-ready-chip">
                {t(key(`home.tr.rs.ready.${n}`))}
              </li>
            ))}
          </ul>
          <p>{t('home.tr.rs.ready.end')}</p>
        </div>
        <Link prefetch={false} className="ac1-quiet" href="/corridors">
          {t('home.other.link')} <Arrow />
        </Link>
        <h3 className="tr-h3">{t('home.tr.not.title')}</h3>
        <div className="tr-nots">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div key={n}>
              <strong>{t(key(`home.tr.not.${n}`))}</strong>
              <span>{t(key(`home.tr.not.${n}.text`))}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function People() {
  const t = useT();
  const [current, setCurrent] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const last = 7;
    let next: number | null = null;
    // Read right to left, the horizontal arrows swap, as the example tabs always did.
    const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward || event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (event.key === back || event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    setCurrent(next);
    tabs.current[next]?.focus();
  };
  return (
    <section className="tr-section" id="who" aria-labelledby="who-title">
      <p className="label ac1-rule">{t('home.tr.pe.eyebrow')}</p>
      <h2 id="who-title">{t('home.tr.pe.title')}</h2>
      <div className="tr-tabs" role="tablist" aria-label={t('home.tr.pe.aria')}>
        {Array.from({ length: 8 }, (_, i) => (
          <button
            key={i}
            ref={(node) => {
              tabs.current[i] = node;
            }}
            type="button"
            role="tab"
            id={`who-tab-${i}`}
            aria-controls="who-panel"
            aria-selected={current === i}
            tabIndex={current === i ? 0 : -1}
            onClick={() => setCurrent(i)}
            onKeyDown={(event) => move(event, i)}
          >
            {t(key(`home.tr.pe.${i}`))}
          </button>
        ))}
      </div>
      <div
        className="tr-people"
        id="who-panel"
        role="tabpanel"
        aria-labelledby={`who-tab-${current}`}
        tabIndex={0}
      >
        <div>
          <p className="label">{t('home.tr.pe.give')}</p>
          <p>{t(key(`home.tr.pe.${current}.give`))}</p>
        </div>
        <div className="is-get">
          <p className="label">{t('home.tr.pe.get')}</p>
          <p>{t(key(`home.tr.pe.${current}.get`))}</p>
        </div>
      </div>
    </section>
  );
}
