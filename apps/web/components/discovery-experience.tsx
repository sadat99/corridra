'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { missionCatalogue } from '@corridra/domain/commercial-missions';
import { countryCodes } from '@corridra/domain/countries';
import { corridorPages, openNote } from '../content/corridors';
import { Arrow } from './arrow';
import { CorridorMap } from './corridor-map';
import { Flag, Flagged, placeMark, type RoutePlace } from './ux/flag';
import { WorldRouteMap } from './world-route-map';

// Open destinations from Bangladesh, as equals (owner decision 17 November 2026, routes and markets). China and the EU
// have their own pages; the UK, the US and Australia have none yet and open the request with both countries filled in.
// The Spain page stays reachable at its own address but is no longer offered as a route here.
const bangladesh: RoutePlace = { name: 'Bangladesh', mark: 'bd' };
const china: RoutePlace = { name: 'China', mark: 'cn' };
const europeanUnion: RoutePlace = { name: 'European Union', mark: 'eu' };
type Direction = {
  key: string;
  from: RoutePlace;
  to: RoutePlace;
  company: string;
  market: string;
  slug: string;
  note: string;
  reverse: boolean;
  world: boolean;
};
const directions: Direction[] = [
  {
    key: 'bangladesh-china',
    from: bangladesh,
    to: china,
    company: 'BD',
    market: 'CN',
    slug: 'bangladesh-china',
    note: corridorPages['bangladesh-china'].qualification,
    reverse: false,
    world: false,
  },
  {
    key: 'bangladesh-eu',
    from: bangladesh,
    to: europeanUnion,
    company: 'BD',
    market: 'EU',
    slug: 'bangladesh-eu',
    note: corridorPages['bangladesh-eu'].qualification,
    reverse: false,
    world: false,
  },
  ...(
    [
      ['bangladesh-uk', { name: 'the UK', mark: 'gb' }, 'GB'],
      ['bangladesh-us', { name: 'the US', mark: 'us' }, 'US'],
      ['bangladesh-au', { name: 'Australia', mark: 'au' }, 'AU'],
    ] as const
  ).map(([key, to, market]) => ({
    key,
    from: bangladesh,
    to,
    company: 'BD',
    market,
    slug: '',
    note: openNote,
    reverse: false,
    world: true,
  })),
  {
    key: 'china-bangladesh',
    from: china,
    to: bangladesh,
    company: 'CN',
    market: 'BD',
    slug: 'bangladesh-china',
    note: corridorPages['bangladesh-china'].reverse,
    reverse: true,
    world: false,
  },
  {
    key: 'eu-bangladesh',
    from: europeanUnion,
    to: bangladesh,
    company: 'EU',
    market: 'BD',
    slug: 'bangladesh-eu',
    note: corridorPages['bangladesh-eu'].reverse,
    reverse: true,
    world: false,
  },
];
/** A route in plain text, in the live wording, for text that cannot hold a mark (the text of a list option). */
const routeText = (route: Direction) => `${route.from.name} → ${route.to.name}`;
/** A route as its two places, each with its mark before it, in the same wording. */
function RouteName({ route }: { route: Direction }) {
  return (
    <>
      <Flagged code={route.from.mark}>{route.from.name}</Flagged> →{' '}
      <Flagged code={route.to.mark}>{route.to.name}</Flagged>
    </>
  );
}
/** The five situations from the Public Experience. Each presets the existing selectors. */
// The card styles every inner span as its small description line, so the "Enter Bangladesh" title keeps its flag
// and name together in the shared `ux-flagged` box on an element that is not a span.
const situations = [
  {
    key: 'source',
    title: 'Source From Suppliers',
    text: 'Find suppliers and compare their offers before you travel.',
    role: 'buyer',
    job: 'sourcing',
    direction: 'bangladesh-china',
  },
  {
    key: 'delegation',
    title: 'Run a Trade Mission',
    text: 'Plan a group visit with clear agendas and results.',
    role: 'institution',
    job: 'delegations',
    direction: 'bangladesh-china',
  },
  {
    key: 'sell',
    title: 'Sell in a New Market',
    text: 'Reach the buyers and distributors that fit what you offer.',
    role: 'exporter',
    job: 'buyers',
    direction: 'bangladesh-eu',
  },
  {
    key: 'enter',
    title: (
      <>
        Enter{' '}
        <bdi className="ux-flagged">
          <Flag code="bd" /> Bangladesh
        </bdi>
      </>
    ),
    text: 'Find customers and partners without a local office.',
    role: 'exporter',
    job: 'market_entry',
    direction: 'eu-bangladesh',
  },
] as const;
const exampleSteps = [
  'Define the objective',
  'Inspect the evidence',
  'Choose the next question',
] as const;

/** Educational selectors only. No identity, readiness decision, persisted mission or API call. */
export function DiscoveryExperience({
  children,
  about,
}: {
  children?: ReactNode;
  about?: ReactNode;
}) {
  const [direction, setDirection] = useState(directions[0].key);
  // Any other route: a company country and a target market chosen freely. Empty means none.
  const [other, setOther] = useState({ company: '', market: '' });
  const [world, setWorld] = useState<typeof import('./world-geography').world | null>(null);
  const [role, setRole] = useState('buyer');
  const [job, setJob] = useState<string>('sourcing');
  const [example, setExample] = useState(false);
  const [step, setStep] = useState(0);
  const exampleHeading = useRef<HTMLHeadingElement>(null);
  const exampleTrigger = useRef<HTMLButtonElement>(null);
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
    code === 'EU' ? europeanUnion.name : (regionNames.of(code) ?? code);
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
          from: { name: placeName(custom.company), mark: placeMark(custom.company) },
          to: { name: placeName(custom.market), mark: placeMark(custom.market) },
          company: custom.company,
          market: custom.market,
          slug: '',
          note: 'No operating offer announced. We tell you plainly if we can help. You can still describe your mission and we will review it.',
          reverse: false,
          world: true,
        }
      : (directions.find((item) => item.key === direction) ?? directions[0]));
  const clearOther = () => setOther({ company: '', market: '' });
  useEffect(() => {
    // The world outline is only needed for routes beyond the two spotlight corridors.
    if (route.world && !world) void import('./world-geography').then((m) => setWorld(m.world));
  }, [route.world, world]);
  const selectedJob = missionCatalogue.find((item) => item.key === job) ?? missionCatalogue[0];
  const sourcing = [
    'sourcing',
    'machinery_procurement',
    'supplier_evaluation',
    'factory_visits',
  ].includes(job);
  // The EU is a bloc, not a company country, so a request from the EU leaves the company country for the person to name.
  const briefUrl = `/plan?${route.company === 'EU' ? '' : `companyCountry=${route.company}&`}marketCode=${route.market}&job=${selectedJob.key}`;
  const fromValue = other.company || route.company;
  const toValue = other.market || route.market;
  const routePanel = (
    <div className="guide-route-box">
      <div className="guide-route-pick">
        <h2>Pick your route</h2>
        <div className="guide-route-field">
          <label htmlFor="atlas-any-company">My company is in</label>
          <select
            id="atlas-any-company"
            disabled={!mounted}
            value={fromValue}
            onChange={(e) => setOther({ company: e.target.value, market: toValue })}
          >
            <option value="EU">European Union (trade bloc)</option>
            {countryCodes.map((code) => (
              <option key={code} value={code}>
                {mounted ? placeName(code) : code}
              </option>
            ))}
          </select>
        </div>
        <div className="guide-route-field">
          <label htmlFor="atlas-any-market">I want to reach</label>
          <select
            id="atlas-any-market"
            disabled={!mounted}
            value={toValue}
            onChange={(e) => setOther({ company: fromValue, market: e.target.value })}
          >
            <option value="EU">European Union (trade bloc)</option>
            {countryCodes.map((code) => (
              <option key={code} value={code}>
                {mounted ? placeName(code) : code}
              </option>
            ))}
          </select>
        </div>
        <div className="guide-route-quick" role="group" aria-label="Quick picks">
          <p>Quick picks</p>
          {directions.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={route.key === item.key}
              onClick={() => {
                setDirection(item.key);
                clearOther();
                setStep(0);
              }}
            >
              <RouteName route={item} />
            </button>
          ))}
          {(other.company || other.market) && (
            <button type="button" onClick={clearOther}>
              Clear
            </button>
          )}
        </div>
      </div>
      <div className="ux-atlas" aria-label="Route map">
        {route.world && world ? (
          <WorldRouteMap
            world={world}
            from={route.company}
            to={route.market}
            names={{ from: placeName(route.company), to: placeName(route.market) }}
          />
        ) : (
          <CorridorMap company={route.company} market={route.market} />
        )}
        <div className="guide-route-result">
          <h3>
            <RouteName route={route} />
          </h3>
          <p className="ux-atlas-note">{route.note}</p>
          <div className="guide-route-actions">
            <Link prefetch={false} className="primary-link" href={briefUrl}>
              Plan a Mission on This Route
            </Link>
            {route.slug && (
              <Link prefetch={false} className="button-secondary" href={`/corridors/${route.slug}`}>
                Read About This Route
              </Link>
            )}
          </div>
          <p className="guide-route-foot">
            Business routes only, not shipping routes or a promise of local coverage.
          </p>
        </div>
      </div>
      <details id="commercial-objective" className="ux-fine-tune guide-fine">
        <summary>Fine-Tune: Your Goal, Role and Route</summary>
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
          <Link prefetch={false} className="ux-situation" href="/network">
            <strong>Help locally</strong>
            <span>Do clear local tasks for a stated reward.</span>
          </Link>
        </div>
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
            Route
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
                  {routeText(item)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="guide-route-foot">
          Perspective describes the example. It does not grant account or workspace access.
        </p>
      </details>
    </div>
  );
  const samplePanel = (
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
        <p>Illustration only. No company, evidence or record is created.</p>
      </div>
      {!example ? (
        <button
          ref={exampleTrigger}
          className="text-link"
          onClick={() => {
            setExample(true);
            setStep(0);
            requestAnimationFrame(() => exampleHeading.current?.focus());
          }}
        >
          Open the Sample Mission
        </button>
      ) : (
        <>
          <p className="ux-example-scope">
            {selectedJob.label} · <RouteName route={route} /> · Sample scenario
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
                  ? 'Give each participant their own goal and private request. Attendance alone is not progress.'
                  : sourcing
                    ? 'Describe the product, the constraints and how you will decide. A proposed visit is not a confirmed meeting.'
                    : 'Describe your offer and the customer or partner worth a conversation. A contact is not a qualified buyer.'}
              </p>
            )}
            {step === 1 && (
              <>
                <span className="guide-tag" data-tone="unknown">
                  Evidence not established
                </span>
                <p>
                  No independent source is supplied here, so a claim stays self-declared. Unknown
                  terms stay unknown.
                </p>
              </>
            )}
            {step === 2 && (
              <p>
                {sourcing
                  ? 'Ask for the missing specification, original quote terms and source. Keep each currency intact. Nothing is sent.'
                  : 'Record the next question, who owns it and what evidence would answer it. A meeting, a commitment and cash are different events.'}
              </p>
            )}
          </div>
          <p>
            {route.reverse
              ? 'This route runs the other way and is taken case by case. No operating offer announced. We tell you plainly if we can help.'
              : 'This route is open now.'}
          </p>
          <Link prefetch={false} className="text-link" href={briefUrl}>
            Start a request on this route <Arrow />
          </Link>
          <button
            className="text-link"
            onClick={() => {
              setExample(false);
              requestAnimationFrame(() => exampleTrigger.current?.focus());
            }}
          >
            Close the Example
          </button>
        </>
      )}
    </section>
  );
  return (
    <section className="ux-discovery guide-routes" aria-label="Explore a commercial objective">
      {/* The six destinations and the Another Route block come first, then the rest of the page open, in this order:
          the older lead and the Spain link, the route picker, the sample mission (owner decision 18 November 2026:
          no tabs on Routes, every section open, nothing removed). */}
      {children}
      {about ? <section className="guide-routes-about">{about}</section> : null}
      {routePanel}
      {samplePanel}
    </section>
  );
}
