'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { countryCodes } from '@corridra/domain/countries';
import { corridorPages } from '../content/corridors';
import { Arrow } from './arrow';
import { CorridorMap } from './corridor-map';
import { WorldRouteMap } from './world-route-map';

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
  // Any other route: a company country and a target market chosen freely. Empty means none.
  const [other, setOther] = useState({ company: '', market: '' });
  const [world, setWorld] = useState<typeof import('./world-geography').world | null>(null);
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
  // Country names come from the browser's own locale data, which can differ from the server's, so
  // the long lists show codes until the page has hydrated.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
  const placeName = (code: string) =>
    code === 'EU' ? 'European Union' : (regionNames.of(code) ?? code);
  const chosen = other.company && other.market && other.company !== other.market ? other : null;
  const known = chosen
    ? directions.find((item) => item.company === chosen.company && item.market === chosen.market)
    : undefined;
  const custom = chosen && !known ? chosen : null;
  const route =
    known ??
    (custom
      ? {
          key: 'custom',
          label: `${placeName(custom.company)} → ${placeName(custom.market)}`,
          company: custom.company,
          market: custom.market,
          slug: '',
          note: 'No operating offer is announced for this route yet. You can still describe your mission and we will review it.',
          reverse: false,
        }
      : (directions.find((item) => item.key === direction) ?? directions[0]));
  const clearOther = () => setOther({ company: '', market: '' });
  useEffect(() => {
    // The world outline is only needed for routes beyond the two spotlight corridors.
    if (custom && !world) void import('./world-geography').then((m) => setWorld(m.world));
  }, [custom, world]);
  const selectedJob = missionCatalogue.find((item) => item.key === job) ?? missionCatalogue[0];
  const sourcing = [
    'sourcing',
    'machinery_procurement',
    'supplier_evaluation',
    'factory_visits',
  ].includes(job);
  const briefUrl = `/plan?companyCountry=${route.company}&marketCode=${route.market}&job=${selectedJob.key}`;
  return (
    <section
      className={'ux-discovery' + (overview ? ' ux-discovery-overview' : '')}
      aria-label="Explore a commercial objective"
    >
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
            <nav className="v3-product-choices" aria-label="Choose your commercial objective">
              <Link prefetch={false} href="/plan?job=buyers">
                <strong>Find Buyers &amp; Partners</strong>
                <span>Reach relevant buyers, distributors and business partners.</span>
                <Arrow />
              </Link>
              <Link prefetch={false} href="/plan?job=sourcing">
                <strong>Find Suppliers &amp; Products</strong>
                <span>Source products, materials or machinery with evidence and clear terms.</span>
                <Arrow />
              </Link>
              <Link prefetch={false} href="/plan?job=delegations">
                <strong>Organise a Delegation</strong>
                <span>Plan the group programme and each participant&apos;s commercial needs.</span>
                <Arrow />
              </Link>
            </nav>
            <Link prefetch={false} className="text-link v3-other-objective" href="/plan">
              Other international business objective <Arrow />
            </Link>
            <div className="ux-hero-actions">
              <a className="text-link" href="#commercial-objective">
                Explore a commercial direction <Arrow />
              </a>
              <a
                ref={exampleTrigger}
                className="text-link"
                href="#mission-example"
                onClick={openExample}
              >
                See a sample mission <Arrow />
              </a>
            </div>
          </div>
        )}
        <div className="ux-atlas" aria-label="Corridor Atlas">
          <div className="ux-atlas-heading">
            <h2>Corridor Atlas</h2>
            <span>Illustrative</span>
          </div>
          {custom && world ? (
            <WorldRouteMap
              world={world}
              from={route.company}
              to={route.market}
              names={{ from: placeName(route.company), to: placeName(route.market) }}
            />
          ) : (
            <CorridorMap company={route.company} market={route.market} />
          )}
          <div className="ux-atlas-legend" role="group" aria-label="Two commercial directions">
            <button
              type="button"
              className="ux-atlas-pick ux-atlas-pick-china"
              aria-pressed={route.company === 'CN' || route.market === 'CN'}
              onClick={() => {
                setDirection('bangladesh-china');
                clearOther();
              }}
            >
              Bangladesh and China
            </button>
            <button
              type="button"
              className="ux-atlas-pick ux-atlas-pick-europe"
              aria-pressed={['ES', 'EU'].includes(route.market) || route.company === 'ES'}
              onClick={() => {
                setDirection('bangladesh-eu');
                clearOther();
              }}
            >
              Bangladesh and Spain or the EU
            </button>
          </div>
          <details className="ux-atlas-any">
            <summary>Another route? Pick any two countries</summary>
            <div className="ux-atlas-any-fields">
              <div className="ux-atlas-any-field">
                <label htmlFor="atlas-any-company">Your company is in</label>
                <select
                  id="atlas-any-company"
                  value={other.company}
                  onChange={(e) => setOther({ ...other, company: e.target.value })}
                >
                  <option value="">Choose a country</option>
                  {countryCodes.map((code) => (
                    <option key={code} value={code}>
                      {mounted ? placeName(code) : code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ux-atlas-any-field">
                <label htmlFor="atlas-any-market">You want to reach</label>
                <select
                  id="atlas-any-market"
                  value={other.market}
                  onChange={(e) => setOther({ ...other, market: e.target.value })}
                >
                  <option value="">Choose a market</option>
                  <option value="EU">European Union (trade bloc)</option>
                  {countryCodes.map((code) => (
                    <option key={code} value={code}>
                      {mounted ? placeName(code) : code}
                    </option>
                  ))}
                </select>
              </div>
              {(other.company || other.market) && (
                <button type="button" className="ux-atlas-clear" onClick={clearOther}>
                  Clear
                </button>
              )}
            </div>
          </details>
          <div className="ux-atlas-selected">
            <h3>{route.label}</h3>
            <p className="ux-atlas-note">{route.note}</p>
            {route.slug ? (
              <Link href={`/corridors/${route.slug}`}>
                Read this corridor&apos;s scope <Arrow />
              </Link>
            ) : (
              <Link href={`/plan?companyCountry=${route.company}&marketCode=${route.market}`}>
                Plan a mission on this route <Arrow />
              </Link>
            )}
          </div>
          <p className="ux-atlas-foot">
            Built for any corridor. These two come first. Commercial directions only, not shipment
            routes or local coverage.
          </p>
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
                clearOther();
                setStep(0);
              }}
            >
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </button>
          ))}
          <Link className="ux-situation" href="/network">
            <strong>Help locally</strong>
            <span>Do clear local tasks for a stated reward.</span>
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
                  clearOther();
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
            See a sample mission <Arrow />
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
        aria-label="Sample mission"
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
            Open the sample mission
          </button>
        ) : (
          <>
            <p className="ux-example-scope">
              {selectedJob.label} · {route.label} · Sample scenario
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
                : 'This is an initial product direction.'}
            </p>
            <Link className="text-link" href={briefUrl}>
              Continue with a sample request <Arrow />
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
