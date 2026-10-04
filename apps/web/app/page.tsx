import { Arrow } from '../components/arrow';
import Link from 'next/link';
import { Corridor } from '../components/corridor';

const jobs = [
  {
    href: '/sell',
    title: 'Sell in a new market',
    text: 'Find buyers, distributors and partners who fit what you offer.',
  },
  {
    href: '/source',
    title: 'Source suppliers',
    text: 'Build a short list worth investigating and visiting.',
  },
  {
    href: '/enter-market',
    title: 'Enter a new market',
    text: 'Find the customers, distributors and local relationships you need.',
  },
  {
    href: '/trade-missions',
    title: 'Run a trade mission',
    text: 'Build commercial agendas and keep the next step in view.',
  },
];
const steps = [
  ['Define the objective', 'Start with what you need to achieve, where and when.'],
  ['Find the right counterparties', 'Research beyond an attendee list or an existing database.'],
  ['Qualify the fit', 'Record relevance, supporting evidence and open questions.'],
  ['Create access', 'Prepare outreach, introductions and scoped local work.'],
  ['Track what happens next', 'Follow the relationship through commercial decisions.'],
];

export default function Home() {
  return (
    <main id="main" tabIndex={-1}>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="label hero-label">CROSS-BORDER MARKET ACCESS</p>
          <h1 id="hero-title">
            Going into a<br className="desktop-break" /> new market?
            <br />
            <span>
              Know who is
              <br className="desktop-break" /> worth meeting.
            </span>
          </h1>
          <p className="hero-description">
            We’re building Corridra to help you identify, qualify and reach the companies that fit
            your commercial objective. Then keep track of what happens next.
          </p>
          <div className="hero-actions">
            <Link prefetch={false} className="primary-link" href="/plan">
              Plan a mission{' '}
              <span aria-hidden="true">
                <Arrow />
              </span>
              <span className="sr-only">(coming soon)</span>
            </Link>
            <span className="launch-status">
              <span aria-hidden="true" />
              Coming soon
            </span>
          </div>
          <Link prefetch={false} className="text-link hero-secondary" href="/how-it-works">
            See how Corridra works <Arrow />
          </Link>
          <p className="hero-reassurance">
            For companies selling, sourcing or entering a new market.
          </p>
        </div>
        <Corridor />
      </section>
      <section className="jobs-section" aria-labelledby="jobs-title">
        <div className="section-heading">
          <p className="label">START WITH YOUR OBJECTIVE</p>
          <h2 id="jobs-title">What are you trying to make happen?</h2>
        </div>
        <div className="jobs-grid">
          {jobs.map((job, index) => (
            <Link prefetch={false} className="job-card" href={job.href} key={job.href}>
              <span className="label">
                0{index + 1}{' '}
                <span aria-hidden="true">
                  <Arrow />
                </span>
              </span>
              <h3>{job.title}</h3>
              <p>{job.text}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="editorial-intro">
        <h2>A foreign trip is too expensive to leave to chance.</h2>
        <div>
          <p>
            You can book the flight, attend the fair and still come home with a list of contacts you
            do not know how to use.
          </p>
          <p>
            The work starts before the meeting: why this company, why now and what would make the
            conversation useful?
          </p>
          <Link prefetch={false} className="text-link" href="/sell">
            Already travelling for business? <Arrow />
          </Link>
        </div>
      </section>
      <section className="process-section" aria-labelledby="process-title">
        <div className="section-heading">
          <p className="label">THE PROCESS WE’RE BUILDING</p>
          <h2 id="process-title">More than a list of companies.</h2>
        </div>
        <ol className="process-list">
          {steps.map(([title, text], index) => (
            <li key={title}>
              <span className="stage-number">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <Link prefetch={false} className="text-link" href="/how-it-works">
          Follow the full process <Arrow />
        </Link>
      </section>
      <section className="feature-grid" aria-label="Evidence and local execution">
        <article>
          <p className="label">TRUST & EVIDENCE</p>
          <h2>Claims are not the same as evidence.</h2>
          <p>
            The planned record distinguishes what a company has declared, what supporting evidence
            exists and what has been checked.
          </p>
          <Link prefetch={false} className="text-link" href="/trust">
            Understand the evidence labels <Arrow />
          </Link>
        </article>
        <article>
          <p className="label">CORRIDRA NETWORK</p>
          <h2>Some questions need someone on the ground.</h2>
          <p>
            We’re building scoped local work around clear tasks, evidence requirements and
            contribution terms. Participation is not open yet.
          </p>
          <Link prefetch={false} className="text-link" href="/network">
            See how participation will work <Arrow />
          </Link>
        </article>
      </section>
      <section className="editorial-intro">
        <h2>A trade mission should produce more than attendance.</h2>
        <div>
          <p>
            We’re building a way for institutions to connect participant objectives to qualified
            agendas, then follow commercial progression after the delegation returns.
          </p>
          <Link prefetch={false} className="text-link" href="/institutions">
            Explore the institutional approach <Arrow />
          </Link>
        </div>
      </section>
      <section className="outcomes-section" aria-labelledby="outcomes-title">
        <p className="label">WHAT COUNTS AS PROGRESS</p>
        <h2 id="outcomes-title">
          A meeting is not a sale.
          <br />A contract is not cash.
        </h2>
        <p>
          The planned record follows distinct commercial events. Each step needs its own evidence.
        </p>
        <ol className="outcome-path">
          {[
            'Identified',
            'Qualified',
            'Engaged',
            'Meeting held',
            'Opportunity',
            'Quotation / sample',
            'Proposal',
            'Commitment',
            'Contract',
            'Invoice',
            'Cash collected',
          ].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Link prefetch={false} className="text-link" href="/trust">
          See what an observed outcome means <Arrow />
        </Link>
      </section>
      <section className="closing public-closing">
        <p className="label">STARTING WITH BANGLADESH ↔ SPAIN / EU</p>
        <h2>
          Make market entry <em>deliberate.</em>
        </h2>
        <p>
          We’re getting the first corridor ready. Mission planning will open here as the delivery
          process and data safeguards are ready.
        </p>
        <Link prefetch={false} className="text-link" href="/plan">
          See the launch status <Arrow />
        </Link>
      </section>
    </main>
  );
}
