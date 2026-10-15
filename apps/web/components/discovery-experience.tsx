'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { corridorPages } from '../content/corridors';
import { Arrow } from './arrow';
import { CorridorMap } from './corridor-map';

const directions = [
  ...Object.entries(corridorPages).map(([slug, content]) => ({
    key: slug,
    label: `Bangladesh → ${content.market === 'EU' ? 'European Union' : content.market === 'CN' ? 'China' : 'Spain'}`,
    company: 'BD',
    market: content.market,
    slug,
    note: content.qualification,
    reverse: false,
  })),
  {
    key: 'china-bangladesh',
    label: 'China → Bangladesh',
    company: 'CN',
    market: 'BD',
    slug: 'bangladesh-china',
    note: corridorPages['bangladesh-china'].reverse,
    reverse: true,
  },
  {
    key: 'spain-bangladesh',
    label: 'Spain → Bangladesh',
    company: 'ES',
    market: 'BD',
    slug: 'bangladesh-spain',
    note: corridorPages['bangladesh-spain'].reverse,
    reverse: true,
  },
];
/** The five situations from the Public Experience. Each presets the existing selectors. */
const situations = [
  {
    key: 'source',
    title: 'Source from suppliers',
    text: 'Find suppliers and compare their offers before you travel.',
    role: 'buyer',
    job: 'sourcing',
    direction: 'bangladesh-china',
  },
  {
    key: 'delegation',
    title: 'Run a trade mission',
    text: 'Plan a group visit with clear agendas and results.',
    role: 'institution',
    job: 'delegations',
    direction: 'bangladesh-china',
  },
  {
    key: 'sell',
    title: 'Sell in a new market',
    text: 'Reach the buyers and distributors that fit what you offer.',
    role: 'exporter',
    job: 'buyers',
    direction: 'bangladesh-eu',
  },
  {
    key: 'enter',
    title: 'Enter Bangladesh',
    text: 'Find customers and partners without a local office.',
    role: 'exporter',
    job: 'market_entry',
    direction: 'spain-bangladesh',
  },
] as const;
const exampleSteps = [
  'Define the objective',
  'Inspect the evidence',
  'Choose the next question',
] as const;

/** Educational selectors only. No identity, readiness decision, persisted mission or API call. */
export function DiscoveryExperience({ overview = false }: { overview?: boolean }) {
  const [direction, setDirection] = useState(directions[0].key);
  const [role, setRole] = useState('buyer');
  const [job, setJob] = useState<string>('sourcing');
  const [example, setExample] = useState(false);
  const [step, setStep] = useState(0);
  const exampleHeading = useRef<HTMLHeadingElement>(null);
  const exampleTrigger = useRef<HTMLAnchorElement>(null);
  function openExample() {
    setExample(true);
    setStep(0);
    requestAnimationFrame(() => exampleHeading.current?.focus());
  }
  useEffect(() => {
    function openFromHash() {
      if (window.location.hash === '#mission-example') {
        setExample(true);
        requestAnimationFrame(() => exampleHeading.current?.focus());
      }
    }
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);
  const activeSituation = situations.find(
    (item) => item.role === role && item.job === job && item.direction === direction,
  )?.key;
  const route = directions.find((item) => item.key === direction) ?? directions[0];
  const selectedJob = missionCatalogue.find((item) => item.key === job) ?? missionCatalogue[0];
  const sourcing = [
    'sourcing',
    'machinery_procurement',
    'supplier_evaluation',
    'factory_visits',
  ].includes(job);
  const briefUrl = `/plan?companyCountry=${route.company}&marketCode=${route.market}&job=${selectedJob.key}`;
  return (
    <section className="ux-discovery" aria-label="Explore a commercial objective">
      <div className="ux-discovery-grid">
        {!overview && (
          <div className="ux-editorial-copy">
            <p className="label">CROSS-BORDER MARKET ACCESS</p>
            <h1>
              The right market.
              <br />
              The right people.
              <br />
              <em>The next move.</em>
            </h1>
            <p className="hero-description">
              Make the commercial objective clear. Understand the evidence behind a potential
              relationship. Keep the next decision and its owner in view.
            </p>
            <div className="ux-hero-actions">
              <a className="primary-link" href="#commercial-objective">
                Explore a commercial direction <Arrow />
              </a>
              <a
                ref={exampleTrigger}
                className="text-link"
                href="#mission-example"
                onClick={openExample}
              >
                See a synthetic mission example <Arrow />
              </a>
            </div>
            <p className="ux-reassurance">
              Explore with invented records. Real customer missions are not open yet.
            </p>
          </div>
        )}
        <div className="ux-atlas" aria-label="Corridor Atlas">
          <div className="ux-atlas-heading">
            <h2>Corridor Atlas</h2>
            <span>Illustrative</span>
          </div>
          <CorridorMap company={route.company} market={route.market} />
          <div className="ux-atlas-legend" role="group" aria-label="Two commercial directions">
            <button
              type="button"
              className="ux-atlas-pick ux-atlas-pick-china"
              aria-pressed={route.company === 'CN' || route.market === 'CN'}
              onClick={() => setDirection('bangladesh-china')}
            >
              Bangladesh and China
            </button>
            <button
              type="button"
              className="ux-atlas-pick ux-atlas-pick-europe"
              aria-pressed={['ES', 'EU'].includes(route.market) || route.company === 'ES'}
              onClick={() => setDirection('bangladesh-eu')}
            >
              Bangladesh and Spain or the EU
            </button>
          </div>
          <p className="ux-atlas-stamp">
            Explore possibilities.
            <br />
            <em>Verify reality.</em>
          </p>
          <p className="ux-atlas-caption">
            Built for any corridor. These two are the ones we are working on first.
          </p>
          <p className="ux-atlas-caption">
            Commercial direction, not a shipment route or a map of local coverage.
          </p>
          <dl className="ux-atlas-facts">
            <div>
              <dt>Selected direction</dt>
              <dd>{route.label}</dd>
            </div>
            <div>
              <dt>Customer operations</dt>
              <dd>Not available</dd>
            </div>
          </dl>
          <p className="ux-atlas-note">{route.note}</p>
          <Link href={`/corridors/${route.slug}`}>
            Read this corridor&apos;s scope <Arrow />
          </Link>
        </div>
      </div>
      <div id="commercial-objective" tabIndex={-1} className="ux-objective-bar">
        <div className="ux-objective-head">
          <p className="label">START WITH YOUR GOAL</p>
          <h2>What are you trying to do?</h2>
        </div>
        <div className="ux-situations" role="group" aria-label="Choose your situation">
          {situations.map((item) => (
            <button
              key={item.key}
              type="button"
              className="ux-situation"
              aria-pressed={activeSituation === item.key}
              onClick={() => {
                setRole(item.role);
                setJob(item.job);
                setDirection(item.direction);
                setStep(0);
              }}
            >
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </button>
          ))}
          <Link className="ux-situation" href="/network">
            <strong>Help locally</strong>
            <span>Do clear local tasks for a stated reward. Not open yet.</span>
          </Link>
        </div>
        <details className="ux-fine-tune">
          <summary>Change role, job or route</summary>
          <div className="ux-fine-tune-fields">
            <label className="field">
              Your perspective
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setJob(
                    e.target.value === 'institution'
                      ? 'delegations'
                      : e.target.value === 'exporter'
                        ? 'buyers'
                        : 'sourcing',
                  );
                }}
              >
                <option value="buyer">Buyer or importer</option>
                <option value="exporter">Exporter or company</option>
                <option value="institution">Institution or delegation</option>
              </select>
            </label>
            <label className="field">
              I&apos;m trying to
              <select
                value={job}
                onChange={(e) => {
                  setJob(e.target.value);
                  setStep(0);
                }}
              >
                {missionCatalogue.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Commercial direction
              <select
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  setStep(0);
                }}
              >
                {directions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
      </div>
      <div className="ux-discovery-actions">
        <p>Perspective describes the example. It does not grant account or workspace access.</p>
        {overview ? (
          <a
            ref={exampleTrigger}
            className="text-link"
            href="#mission-example"
            onClick={openExample}
          >
            See a synthetic mission example <Arrow />
          </a>
        ) : (
          <button className="text-link" onClick={openExample}>
            Explore this objective <Arrow />
          </button>
        )}
        <Link className="primary-link" href={briefUrl}>
          Prepare this example request <Arrow />
        </Link>
      </div>
      <section
        id="mission-example"
        tabIndex={-1}
        className={`ux-example${example ? ' ux-example-open' : ''}`}
        aria-label="Synthetic mission example"
      >
        <div>
          <p className="label">A 90-SECOND WALKTHROUGH</p>
          <h2 ref={exampleHeading} tabIndex={-1}>
            A mission, before anyone commits.
          </h2>
          <p>
            Illustration only. No company, source evidence or mission record is created. No signup
            required.
          </p>
        </div>
        {!example ? (
          <button
            className="text-link"
            onClick={() => {
              setExample(true);
              requestAnimationFrame(() => exampleHeading.current?.focus());
            }}
          >
            Open the synthetic example
          </button>
        ) : (
          <>
            <p className="ux-example-scope">
              {selectedJob.label} · {route.label} · Invented scenario
            </p>
            <nav className="ux-example-steps" aria-label="Example steps">
              {exampleSteps.map((label, index) => (
                <button
                  key={label}
                  onClick={() => setStep(index)}
                  aria-current={index === step ? 'step' : undefined}
                >
                  {index + 1}. {label}
                </button>
              ))}
            </nav>
            <div className="ux-example-decision" role="status">
              <h3>{exampleSteps[step]}</h3>
              {step === 0 && (
                <p>
                  {job === 'delegations'
                    ? 'Give each participant an independent objective and private request. Attendance alone does not establish commercial progress.'
                    : sourcing
                      ? 'Describe the product or equipment, constraints and decision criteria before researching a supplier. A proposed visit is not a confirmed appointment.'
                      : 'Describe the offer and the kind of customer or partner that would make a conversation useful. A contact is not a qualified buyer.'}
                </p>
              )}
              {step === 1 && (
                <>
                  <span className="ux-status" data-tone="unknown">
                    Evidence not established
                  </span>
                  <p>
                    In this illustration, no independent source has been supplied. A declaration
                    would remain self-declared until the existing evidence process establishes more.
                    Unknown terms stay unknown.
                  </p>
                </>
              )}
              {step === 2 && (
                <p>
                  {sourcing
                    ? 'Ask for the missing specification, original quotation terms and supporting source. Keep each currency and source version intact. Nothing is sent from this example.'
                    : 'Record the next question, the person responsible and what evidence would answer it. A meeting, commitment and cash observation remain distinct events.'}
                </p>
              )}
            </div>
            <p>
              {route.reverse
                ? 'This reverse direction needs its own configured scope. No operating offer is announced.'
                : 'This is an initial product direction, not approval to admit real customer missions.'}
            </p>
            <Link className="text-link" href={briefUrl}>
              Continue with an invented request <Arrow />
            </Link>
            <button
              className="text-link"
              onClick={() => {
                setExample(false);
                requestAnimationFrame(() => exampleTrigger.current?.focus());
              }}
            >
              Close the example
            </button>
          </>
        )}
      </section>
    </section>
  );
}
