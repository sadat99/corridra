import { Arrow } from '../components/arrow';
import { FactLabel, factLabels } from '../components/fact-label';
import Link from 'next/link';
import { LegacyHashRedirect } from '../components/legacy-hash-redirect';
import { PublicShell } from '../components/public-shell';

const starts = [
  {
    href: '/plan?job=buyers',
    title: 'Sell my products',
    text: 'Find buyers and partners.',
    name: 'Find Buyers & Partners',
    icon: (
      <>
        <path d="M5 8h14l-1 12H6z" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" />
      </>
    ),
  },
  {
    href: '/plan?job=sourcing',
    title: 'Buy products or machines',
    text: 'Find suppliers. Compare price quotes.',
    name: 'Find Suppliers & Products',
    icon: (
      <>
        <path d="M2 21h20" />
        <path d="M4 21V11l5 3v-3l5 3V5h6v16" />
      </>
    ),
  },
  {
    href: '/plan?job=delegations',
    title: 'Lead a group trip',
    text: 'Plan the programme and meetings.',
    name: 'Organise a Delegation',
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M17 14c2.5 0 5 1.8 5 4.5" />
      </>
    ),
  },
] as const;

const steps = [
  ['Say what you need', 'What you want to buy, sell or organise, and when.'],
  ['Find the right companies', 'We look at the whole market, not only one fair.'],
  ['Review before you meet', 'See why each company fits and what has evidence.'],
  ['Meet and follow up', 'Plan meetings. Track what happens next.'],
] as const;

const example = [
  ['Makes cotton knitwear', 'Self-declared'],
  ['Factory certificate on file', 'Evidence available'],
  ['Business address checked', 'Verified'],
  ['Likely fit for a first order', 'Derived'],
  ['Meeting held, sample requested', 'Outcome observed'],
] as const;

function ExampleCard({ className }: { className: string }) {
  return (
    <aside className={`guide-example ${className}`} aria-label="Example of a company card">
      <p className="label">EXAMPLE ONLY, NOT A REAL COMPANY</p>
      <h2>What you see for each company</h2>
      <ul>
        {example.map(([text, label]) => (
          <li key={label}>
            <span>{text}</span>
            <FactLabel label={label} />
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function Home() {
  return (
    <PublicShell className="ux-guide-home">
      <LegacyHashRedirect />
      <section className="guide-hero" aria-labelledby="home-title">
        <div className="guide-hero-copy">
          <p className="label">CROSS-BORDER MARKET ACCESS</p>
          <h1 id="home-title">
            Find the right market.
            <br />
            Meet the right people.
            <br />
            <em>Know what to do next.</em>
          </h1>
          <p className="guide-lead">
            Say what you want to buy, sell or organise. We show which companies fit, what is proven
            about them and what to do next.
          </p>
        </div>
        <ExampleCard className="guide-example-hero" />
      </section>

      <section className="guide-start" aria-label="Choose what you want to do">
        <p className="label">CHOOSE ONE TO START</p>
        <nav className="guide-choices" aria-label="Choose your commercial objective">
          {starts.map((start) => (
            <Link prefetch={false} key={start.href} href={start.href}>
              <span className="guide-choice-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {start.icon}
                </svg>
              </span>
              <span className="guide-choice-text">
                <strong>{start.title}</strong>
                <span>{start.text}</span>
                <span className="label guide-choice-name">{start.name}</span>
              </span>
              <span className="guide-choice-start" aria-hidden="true">
                Start <Arrow />
              </span>
              <span className="guide-choice-go" aria-hidden="true">
                <Arrow />
              </span>
            </Link>
          ))}
        </nav>
        <div className="guide-start-more">
          <Link prefetch={false} className="button-secondary" href="/plan">
            Something else? Tell us your business goal <Arrow />
          </Link>
          <p>
            Corridra does not promise orders. We do research, review, introductions and meetings.
          </p>
        </div>
      </section>

      <section className="guide-steps" aria-labelledby="steps-title">
        <p className="label">HOW IT WORKS</p>
        <h2 id="steps-title">One mission, four clear steps.</h2>
        <p className="guide-lead">
          A mission is a planned piece of work to meet the right companies.
        </p>
        <ol aria-label="How a mission works">
          {steps.map(([title, text], index) => (
            <li key={title}>
              <span className="guide-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>
        <Link prefetch={false} className="text-link" href="/how-it-works">
          See the full process <Arrow />
        </Link>
      </section>

      <section className="guide-facts" aria-labelledby="facts-title">
        <p className="label">WHAT WE SHOW YOU</p>
        <h2 id="facts-title">Every fact says where it comes from.</h2>
        <p className="guide-lead">
          You always see whether a statement is only claimed, or has proof behind it.
        </p>
        <ExampleCard className="guide-example-phone" />
        <ul>
          {factLabels.map((fact) => (
            <li key={fact.label}>
              <FactLabel label={fact.label} />
              <span>{fact.line}</span>
            </li>
          ))}
        </ul>
        <Link prefetch={false} className="text-link" href="/trust">
          How we label facts <Arrow />
        </Link>
      </section>

      <section className="guide-band" aria-label="Start a request">
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
