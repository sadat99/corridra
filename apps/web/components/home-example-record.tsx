'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { CorridraIcon } from './corridra-icon';
import { FactLabel, type factLabels } from './fact-label';

type Fact = (typeof factLabels)[number]['label'];

type Example = {
  id: string;
  tab: string;
  job: string;
  from: string;
  to: string;
  title: string;
  meta: string;
  companies: readonly (readonly [string, string, Fact])[];
  next: string;
};

/** Example missions on the home page. Sample data only: no real company, no stored record. */
const examples: readonly Example[] = [
  {
    id: 'sell',
    tab: 'Selling',
    job: 'Sell my products',
    from: 'Bangladesh',
    to: 'Spain',
    title: 'Meet three knitwear buyers during a Madrid trade fair.',
    meta: 'Request received 15 Oct 2026 · 4 of 11 companies reviewed for fit',
    companies: [
      [
        'Distributor A, Madrid',
        'Sells knitwear to about 40 shops. Asked for a price list.',
        'Evidence available',
      ],
      [
        'Retail buyer B, Valencia',
        'Says it buys private label. Not yet confirmed.',
        'Self-declared',
      ],
      ['Importer C, Barcelona', 'Company registration checked.', 'Verified'],
      ['Agent D, Seville', 'Not a fit: says it only works with EU makers.', 'Self-declared'],
    ],
    next: 'Confirm two meetings in the fair week.',
  },
  {
    id: 'buy',
    tab: 'Sourcing',
    job: 'Buy products or machines',
    from: 'Bangladesh',
    to: 'China',
    title: 'Find two suppliers of circular knitting machines.',
    meta: 'Request received 15 Oct 2026 · 3 of 9 companies reviewed for fit',
    companies: [
      ['Supplier A, Ningbo', 'Price quote received. Installation included.', 'Evidence available'],
      ['Supplier B, Foshan', 'Says it exports to Dhaka. No document yet.', 'Self-declared'],
      ['Supplier C, Dongguan', 'Factory address checked.', 'Verified'],
      ['Supplier D, Wenzhou', 'Not a fit: no after-sales service in Bangladesh.', 'Self-declared'],
    ],
    next: 'Compare what each price quote includes.',
  },
];

const stages = ['Request', 'Find companies', 'Review for fit', 'Meet', 'Follow up'] as const;
const current = 2;

export function HomeExampleRecord() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = examples.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? active === last
          ? 0
          : active + 1
        : event.key === 'ArrowLeft'
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
    <article className="ac1-record" aria-label="Example missions, not real companies">
      <div className="ac1-record-head">
        <span className="ac1-example-tag">Example</span>
        <div className="ac1-record-tabs" role="tablist" aria-label="Example mission">
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
              {example.tab}
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
              {example.job} ·{' '}
              <span className="ac1-route">
                {example.from} <CorridraIcon name="arrow" size={16} /> {example.to}
              </span>
            </p>
            <h2>{example.title}</h2>
            <p className="ac1-record-meta">{example.meta}</p>
          </div>
          <ol className="ac1-track" aria-label="Mission progress">
            {stages.map((stage, step) => (
              <li
                key={stage}
                className={step < current ? 'is-done' : step === current ? 'is-now' : undefined}
                aria-current={step === current ? 'step' : undefined}
              >
                {stage}
              </li>
            ))}
          </ol>
          <ul className="ac1-companies" aria-label="Example companies">
            {example.companies.map(([name, note, fact]) => (
              <li key={name}>
                <strong>{name}</strong>
                <span>{note}</span>
                <FactLabel label={fact} />
              </li>
            ))}
          </ul>
          <div className="ac1-next">
            <div>
              <p className="label">Next step</p>
              <p>{example.next}</p>
            </div>
            <CorridraIcon name="arrow" />
          </div>
        </div>
      ))}
    </article>
  );
}
