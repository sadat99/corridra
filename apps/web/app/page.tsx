import { Arrow } from '../components/arrow';
import { CorridraIcon } from '../components/corridra-icon';
import { FactLabel, factLabels } from '../components/fact-label';
import { HomeExampleRecord } from '../components/home-example-record';
import Link from 'next/link';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';

const starts = [
  {
    href: '/plan?job=buyers',
    title: 'Sell my products',
    text: 'Find buyers and partners abroad.',
    name: 'Find Buyers & Partners',
    icon: 'sell',
  },
  {
    href: '/plan?job=sourcing',
    title: 'Buy products or machines',
    text: 'Find suppliers. Compare price quotes.',
    name: 'Find Suppliers & Products',
    icon: 'buy',
  },
  {
    href: '/plan?job=delegations',
    title: 'Lead a group trip',
    text: 'Plan the programme and the meetings.',
    name: 'Organise a Delegation',
    icon: 'trip',
  },
] as const;

const steps = [
  ['Say what you need', 'What you want to buy, sell or organise, and when.'],
  ['Find the right companies', 'We look beyond one fair or one directory.'],
  ['Review before you meet', 'See why each company fits and what is proven.'],
  ['Meet and follow up', 'Plan meetings. Track what happens next.'],
] as const;

const buyers = [
  [
    'Distributor A, Madrid',
    'Sells knitwear to about 40 shops. Asked for a price list.',
    'Evidence available',
    'Introduction proposed',
  ],
  [
    'Retail buyer B, Valencia',
    'Buys private label for its own stores.',
    'Self-declared',
    'Meeting proposed',
  ],
  ['Importer C, Barcelona', 'Company registration checked.', 'Verified', 'Meeting confirmed'],
  [
    'Agent D, Seville',
    'Not a fit: says it only works with EU makers.',
    'Self-declared',
    'Not contacted',
  ],
] as const;

const suppliers = ['Supplier A', 'Supplier B', 'Supplier C'] as const;

const quotes: readonly {
  term: string;
  note?: string;
  values: readonly (readonly [string, 'num' | 'ok' | 'miss' | 'bad'])[];
}[] = [
  {
    term: 'Price quote',
    values: [
      ['USD 42,000', 'num'],
      ['USD 38,500', 'num'],
      ['USD 45,700', 'num'],
    ],
  },
  {
    term: 'Delivery terms',
    note: 'FOB: price at the port in China. CIF: price includes sea freight and insurance to Chattogram.',
    values: [
      ['FOB Ningbo', 'num'],
      ['Not stated', 'miss'],
      ['CIF Chattogram', 'num'],
    ],
  },
  {
    term: 'Installation',
    values: [
      ['Included', 'ok'],
      ['Not included', 'bad'],
      ['Not confirmed', 'miss'],
    ],
  },
  {
    term: 'Lead time',
    values: [
      ['90 days', 'num'],
      ['75 days', 'num'],
      ['120 days', 'num'],
    ],
  },
];

const routes = [
  {
    href: '/corridors/bangladesh-china',
    from: 'Bangladesh',
    to: 'China',
    text: 'Go to China knowing which suppliers, factories and price terms deserve your attention.',
  },
  {
    href: '/corridors/bangladesh-spain',
    from: 'Bangladesh',
    to: 'Spain and the EU',
    text: 'Know who is worth meeting before you travel, including companies outside the fair list.',
  },
] as const;

export default function Home() {
  return (
    <PublicShell className="ux-guide-home ac1-home">
      <LegacyHashRedirect />
      <section className="ac1-hero" aria-labelledby="home-title">
        <div className="ac1-hero-copy">
          <p className="label ac1-rule">Cross-border market access</p>
          <h1 id="home-title">Make market entry deliberate.</h1>
          <p className="ac1-lead">
            Say what you want to buy, sell or organise. We find the companies that fit, show what is
            proven about each one, and help you meet them.
          </p>
          <nav className="ac1-jobs" aria-label="Choose your commercial objective">
            {starts.map((start) => (
              <Link prefetch={false} key={start.href} href={start.href}>
                <CorridraIcon name={start.icon} className="ac1-job-icon" />
                <span>
                  <strong>{start.title}</strong>
                  <span className="ac1-job-text">{start.text}</span>
                  <span className="label ac1-job-name">{start.name}</span>
                </span>
                <CorridraIcon name="arrow" className="ac1-job-go" />
              </Link>
            ))}
          </nav>
          <Link prefetch={false} className="ac1-quiet" href="/plan">
            Something else? Tell us your business goal <Arrow />
          </Link>
          <ul className="ac1-calm">
            <li>
              <CorridraIcon name="check" size={16} />
              No account needed to begin
            </li>
            <li>
              <CorridraIcon name="check" size={16} />
              Nothing is sent until you check it
            </li>
          </ul>
          <p className="ac1-note">
            Corridra does not promise orders. We do research, review, introductions and meetings.
          </p>
        </div>
        <HomeExampleRecord />
      </section>

      <section className="ac1-section" aria-labelledby="steps-title">
        <p className="label ac1-rule">How it works</p>
        <h2 id="steps-title">One mission, four clear steps.</h2>
        <p className="ac1-lead">
          A mission is a planned piece of work to meet the right companies.
        </p>
        <ol className="ac1-steps" aria-label="How a mission works">
          {steps.map(([title, text], index) => (
            <li key={title}>
              <span className="ac1-step-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <Link prefetch={false} className="ac1-quiet" href="/how-it-works">
          See the full process <Arrow />
        </Link>
      </section>

      <section className="ac1-section" aria-labelledby="proof-title">
        <p className="label ac1-rule">Example</p>
        <h2 id="proof-title">What you get back, when you sell and when you buy.</h2>
        <p className="ac1-lead">
          Every company comes with a reason and a trust label. The companies below are examples, not
          real companies.
        </p>
        <div className="ac1-proof">
          <div>
            <h3 className="ac1-proof-title">
              <CorridraIcon name="sell" /> Buyers worth meeting
            </h3>
            <p>A buyer list is only useful if you know why each one fits and what is proven.</p>
          </div>
          <ul className="ac1-buyers" aria-label="Example buyer shortlist">
            {buyers.map(([name, note, fact, state]) => (
              <li key={name}>
                <strong>{name}</strong>
                <span>{note}</span>
                <FactLabel label={fact} />
                <span className="ac1-state">{state}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="ac1-proof">
          <div>
            <h3 className="ac1-proof-title">
              <CorridraIcon name="buy" /> Price quotes side by side
            </h3>
            <p>A low price can hide a missing cost. We show what each price quote includes.</p>
          </div>
          <div className="ac1-compare" role="table" aria-label="Example price quote comparison">
            <div className="ac1-compare-row ac1-compare-head" role="row">
              <span role="columnheader">Term</span>
              {suppliers.map((supplier) => (
                <span role="columnheader" key={supplier}>
                  {supplier}
                </span>
              ))}
            </div>
            {quotes.map((quote) => (
              <div className="ac1-compare-row" role="row" key={quote.term}>
                <span role="rowheader">
                  {quote.term}
                  {quote.note ? <small>{quote.note}</small> : null}
                </span>
                {quote.values.map(([value, tone], index) => (
                  <span
                    role="cell"
                    key={suppliers[index]}
                    data-supplier={suppliers[index]}
                    data-tone={tone}
                  >
                    {value}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ac1-section" aria-labelledby="facts-title">
        <p className="label ac1-rule">What we show you</p>
        <h2 id="facts-title">Every fact says where it comes from.</h2>
        <p className="ac1-lead">
          You always see whether a statement is only claimed, or has proof behind it.
        </p>
        <ul className="ac1-truth">
          {factLabels.map((fact) => (
            <li key={fact.label}>
              <FactLabel label={fact.label} />
              <span>{fact.line}</span>
            </li>
          ))}
        </ul>
        <Link prefetch={false} className="ac1-quiet" href="/trust">
          How we label facts <Arrow />
        </Link>
      </section>

      <section className="ac1-section" aria-labelledby="routes-title">
        <p className="label ac1-rule">Routes</p>
        <h2 id="routes-title">Two routes to start.</h2>
        <p className="ac1-lead">
          A route is a commercial direction, not a shipping lane or a promise of local service.
        </p>
        <div className="ac1-routes">
          {routes.map((route) => (
            <article key={route.href}>
              <h3>
                {route.from} <CorridraIcon name="arrow" /> {route.to}
              </h3>
              <p>{route.text}</p>
              <Link prefetch={false} className="ac1-quiet" href={route.href}>
                See this route <Arrow />
              </Link>
            </article>
          ))}
        </div>
        <div className="ac1-other">
          <p>
            <strong>Another route?</strong> Ask us. We tell you plainly if we can help.
          </p>
          <Link prefetch={false} className="button-secondary" href="/corridors">
            Explore every route
          </Link>
        </div>
      </section>

      <section className="guide-band ac1-band" aria-label="Start a request">
        <div>
          <h2>Not sure where to start?</h2>
          <p>Tell us your goal in your own words. You do not need an account to begin.</p>
        </div>
        <Link prefetch={false} className="primary-link" href="/plan">
          Start a request
        </Link>
      </section>
    </PublicShell>
  );
}
