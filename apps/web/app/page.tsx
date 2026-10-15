import { Arrow } from '../components/arrow';
import Link from 'next/link';
import { DiscoveryExperience } from '../components/discovery-experience';
import { PublicShell } from '../components/public-shell';

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
    <PublicShell className="ux-home">
      <DiscoveryExperience />
      <section className="ux-lead" aria-labelledby="lead-title">
        <p className="label">START HERE</p>
        <h2 id="lead-title">Work with companies in China, step by step.</h2>
        <p className="ux-lead-note">
          Today you can try an example with invented data. Real projects open after our checks are
          complete.
        </p>
        <div className="ux-lead-paths">
          <article className="detail-card">
            <h3>Source products from China</h3>
            <p>Find suppliers and factories. Compare price quotes. Plan your visits.</p>
            <Link prefetch={false} className="primary-link" href="/source">
              See how sourcing works <Arrow />
            </Link>
            <Link prefetch={false} className="text-link" href="/machinery">
              Buying machinery? Start here
            </Link>
          </article>
          <article className="detail-card">
            <h3>Lead a delegation to China</h3>
            <p>
              Take a group to meet the right companies. Keep the agenda, the meetings and the
              results in one place.
            </p>
            <Link prefetch={false} className="primary-link" href="/trade-missions">
              See how delegations work <Arrow />
            </Link>
            <Link prefetch={false} className="text-link" href="/institutions">
              Organising for a chamber or institution? Start here
            </Link>
          </article>
        </div>
        <ol className="ux-lead-steps" aria-label="How a project works">
          <li>
            <span className="stage-number">1</span>
            <h3>Say what you need</h3>
            <p>Tell us what you want to buy or achieve, and when.</p>
          </li>
          <li>
            <span className="stage-number">2</span>
            <h3>Review companies</h3>
            <p>See which companies fit. We show what is stated and what is checked.</p>
          </li>
          <li>
            <span className="stage-number">3</span>
            <h3>Meet the right people</h3>
            <p>Plan introductions, meetings and visits.</p>
          </li>
          <li>
            <span className="stage-number">4</span>
            <h3>Decide with clear proof</h3>
            <p>Compare price quotes and documents. You make the decision.</p>
          </li>
        </ol>
      </section>
      <details className="ux-home-guide">
        <summary>Explore the mission workflow, services and commercial outcomes</summary>
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
              You can book the flight, attend the fair and still come home with a list of contacts
              you do not know how to use.
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
            <p className="label">THE MISSION WORKFLOW</p>
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
              The mission record distinguishes what a company has declared, what supporting evidence
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
            The mission record follows distinct commercial events. Each step needs its own evidence.
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
          <p className="label">INITIAL COMMERCIAL DIRECTIONS</p>
          <h2>
            Make market entry <em>deliberate.</em>
          </h2>
          <p>
            We’re validating the shared mission workflow with invented records. Real mission
            delivery will open only after the operating and data controls are approved.
          </p>
          <Link prefetch={false} className="text-link" href="/plan">
            See the launch status <Arrow />
          </Link>
        </section>
      </details>
    </PublicShell>
  );
}
