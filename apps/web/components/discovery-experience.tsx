'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { corridorPages } from '../content/corridors';
import { Arrow } from './arrow';

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
  const route = directions.find((item) => item.key === direction) ?? directions[0];
  const selectedJob = missionCatalogue.find((item) => item.key === job) ?? missionCatalogue[0];
  const sourcing = [
    'sourcing',
    'machinery_procurement',
    'supplier_evaluation',
    'factory_visits',
  ].includes(job);
  const briefUrl = `/plan?companyCountry=${route.company}&marketCode=${route.market}&job=${selectedJob.key}`;
  const target =
    route.market === 'CN'
      ? [470, 166]
      : route.market === 'ES'
        ? [128, 166]
        : route.market === 'EU'
          ? [318, 110]
          : [258, 246];
  const origin =
    route.company === 'CN' ? [470, 166] : route.company === 'ES' ? [128, 166] : [258, 246];
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
          <svg viewBox="0 0 600 340" aria-hidden="true" className="ux-atlas-map">
            <defs>
              <pattern id="atlas-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="2" cy="2" r="1" fill="#719280" />
              </pattern>
            </defs>
            <rect width="600" height="340" fill="url(#atlas-grid)" opacity="0.25" />
            <ellipse cx="300" cy="174" rx="262" ry="132" />
            <ellipse cx="300" cy="174" rx="162" ry="132" />
            <path d="M38 174h524M63 108h474M63 240h474" />
            <path
              className="ux-atlas-direction"
              d={`M${origin[0]} ${origin[1]} Q330 75 ${target[0]} ${target[1]}`}
            />
            <circle cx="258" cy="246" r="7" />
            <text x="228" y="278">
              Bangladesh
            </text>
            <circle cx="470" cy="166" r="7" />
            <text x="482" y="158">
              China
            </text>
            <circle cx="128" cy="166" r="5" />
            <text x="60" y="156">
              Spain
            </text>
            <circle cx="318" cy="110" r="5" />
            <text x="326" y="96">
              EU bloc
            </text>
          </svg>
          <p className="ux-atlas-stamp">
            Explore possibilities.
            <br />
            <em>Verify reality.</em>
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
        <div>
          <p className="label">START WITH YOUR OBJECTIVE</p>
          <h2>What needs to happen?</h2>
        </div>
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
