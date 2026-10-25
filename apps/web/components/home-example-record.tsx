'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { CorridraIcon } from './corridra-icon';
import { FactLabel, type factLabels } from './fact-label';
import { useT } from './language-provider';
import type { MessageKey } from '../lib/i18n/messages';

type Fact = (typeof factLabels)[number]['label'];

type Example = {
  id: string;
  tab: MessageKey;
  job: MessageKey;
  from: MessageKey;
  to: MessageKey;
  title: MessageKey;
  meta: MessageKey;
  companies: readonly (readonly [MessageKey, MessageKey, Fact])[];
  next: MessageKey;
};

/**
 * Example missions on the home page. Sample data only: no real company, no stored record. The words are keys in the
 * message files; the five trust names stay English in every language.
 */
const examples: readonly Example[] = [
  {
    id: 'sell',
    tab: 'home.ex.sell.tab',
    job: 'home.start.sell.title',
    from: 'home.country.bd',
    to: 'home.country.es',
    title: 'home.ex.sell.title',
    meta: 'home.ex.sell.meta',
    companies: [
      ['home.buyer.a.name', 'home.buyer.a.note', 'Evidence available'],
      ['home.buyer.b.name', 'home.ex.sell.b.note', 'Self-declared'],
      ['home.buyer.c.name', 'home.buyer.c.note', 'Verified'],
      ['home.buyer.d.name', 'home.buyer.d.note', 'Self-declared'],
    ],
    next: 'home.ex.sell.next',
  },
  {
    id: 'buy',
    tab: 'home.ex.buy.tab',
    job: 'home.start.buy.title',
    from: 'home.country.bd',
    to: 'home.country.cn',
    title: 'home.ex.buy.title',
    meta: 'home.ex.buy.meta',
    companies: [
      ['home.ex.buy.a.name', 'home.ex.buy.a.note', 'Evidence available'],
      ['home.ex.buy.b.name', 'home.ex.buy.b.note', 'Self-declared'],
      ['home.ex.buy.c.name', 'home.ex.buy.c.note', 'Verified'],
      ['home.ex.buy.d.name', 'home.ex.buy.d.note', 'Self-declared'],
    ],
    next: 'home.ex.buy.next',
  },
];

const stages: readonly MessageKey[] = [
  'home.ex.stage.request',
  'home.ex.stage.find',
  'home.ex.stage.review',
  'home.ex.stage.meet',
  'home.ex.stage.follow',
];
const current = 2;

export function HomeExampleRecord() {
  const t = useT();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = examples.length - 1;
    // Where the text reads right to left the tabs are laid out right to left, so the arrow keys swap.
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next = rtl ? 'ArrowLeft' : 'ArrowRight';
    const previous = rtl ? 'ArrowRight' : 'ArrowLeft';
    const target =
      event.key === next
        ? active === last
          ? 0
          : active + 1
        : event.key === previous
          ? active === 0
            ? last
            : active - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    setActive(target);
    tabs.current[target]?.focus();
  }

  return (
    <article className="ac1-record" aria-label={t('home.ex.aria')}>
      <div className="ac1-record-head">
        <span className="ac1-example-tag">{t('home.example')}</span>
        <div className="ac1-record-tabs" role="tablist" aria-label={t('home.ex.tabs.aria')}>
          {examples.map((example, index) => (
            <button
              key={example.id}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`home-example-tab-${example.id}`}
              aria-controls={`home-example-panel-${example.id}`}
              aria-selected={active === index}
              tabIndex={active === index ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={onKeyDown}
            >
              {t(example.tab)}
            </button>
          ))}
        </div>
      </div>
      {examples.map((example, index) => (
        <div
          key={example.id}
          className="ac1-record-body"
          role="tabpanel"
          id={`home-example-panel-${example.id}`}
          aria-labelledby={`home-example-tab-${example.id}`}
          hidden={active !== index}
        >
          <div>
            <p className="label">
              {t(example.job)} ·{' '}
              <span className="ac1-route">
                {t(example.from)}{' '}
                <CorridraIcon name="arrow" size={16} className="ac1-route-arrow" /> {t(example.to)}
              </span>
            </p>
            <h2>{t(example.title)}</h2>
            <p className="ac1-record-meta">{t(example.meta)}</p>
          </div>
          <ol className="ac1-track" aria-label={t('home.ex.progress.aria')}>
            {stages.map((stage, step) => (
              <li
                key={stage}
                className={step < current ? 'is-done' : step === current ? 'is-now' : undefined}
                aria-current={step === current ? 'step' : undefined}
              >
                {t(stage)}
              </li>
            ))}
          </ol>
          <ul className="ac1-companies" aria-label={t('home.ex.companies.aria')}>
            {example.companies.map(([name, note, fact]) => (
              <li key={name}>
                <strong>{t(name)}</strong>
                <span>{t(note)}</span>
                <FactLabel label={fact} english />
              </li>
            ))}
          </ul>
          <div className="ac1-next">
            <div>
              <p className="label">{t('home.ledger.next')}</p>
              <p>{t(example.next)}</p>
            </div>
            <CorridraIcon name="arrow" className="ac1-route-arrow" />
          </div>
        </div>
      ))}
    </article>
  );
}
