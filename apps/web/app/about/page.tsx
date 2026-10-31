import Link from 'next/link';
import { PublicShell } from '../../components/public-shell';

export const metadata = {
  title: 'About Corridra | Commercial progress across borders',
  description:
    'What Corridra does, who it serves, how a mission works and how commercial progress is assessed.',
};

const useCases = [
  [
    'Find buyers and partners',
    'For exporters and companies entering a market. Define the right company, explain the offer and plan useful conversations.',
  ],
  [
    'Source products and machinery',
    'For importers and purchasing teams. Turn a buying requirement into supplier questions, comparisons and purposeful visits.',
  ],
  [
    'Make a business visit count',
    'For companies preparing a trade fair, factory visit or market visit. Agree objectives before travel and follow up after meetings.',
  ],
  [
    'Run a delegation or programme',
    'For chambers, institutions and organisers. Coordinate the programme while keeping each participant’s objectives and private information separate.',
  ],
];
// The customer road (D5): the same six steps the home page, How it works and the account use.
const missionProcess = [
  ['Define', 'Tell us the market, the commercial need and what would make the work worthwhile.'],
  ['Find', 'We research companies that could fit and agree the scope and any fees with you first.'],
  ['Compare', 'See each company and offer side by side, with what is claimed and what is checked.'],
  ['Visit', 'We prepare introductions and coordinate the meetings and visits you agree to.'],
  ['Decide', 'Choose who to work with, with the evidence and the open questions in view.'],
  [
    'Follow through',
    'Keep the next action, the responsible person and the evidence with the work until there is a result.',
  ],
];

export default function Page() {
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <nav className="guide-crumb" aria-label="Breadcrumb">
            <Link prefetch={false} href="/">
              Corridra
            </Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">About</span>
          </nav>
          <p className="label">About Corridra</p>
          <h1>Make market entry deliberate.</h1>
          <p className="guide-lead">
            Corridra helps companies turn a cross-border commercial objective into planned work,
            relevant relationships and accountable follow-through.
          </p>
          <Link className="primary-link" prefetch={false} href="/plan">
            Start a request
          </Link>
        </div>
      </section>
      <section className="guide-doc" aria-label="Understanding Corridra">
        <article id="why">
          <h2>Why Corridra exists</h2>
          <div>
            <p>
              A contact list is a starting point. A business trip is an opportunity. Neither tells
              you which company fits, what is known or who will take the next step.
            </p>
            <p>
              Corridra brings that work together: a clear objective, relevant company context,
              practical coordination and a record of what happened.
            </p>
          </div>
        </article>
        <article id="what">
          <h2>What a mission means</h2>
          <div>
            <p>
              A mission is a planned piece of work to meet the right companies and advance a
              commercial objective. It can support a buying decision, a market-entry effort or a
              group programme.
            </p>
            <p>
              The request, company context, tasks, evidence and progress belong to the same working
              record. The aim is to make the next useful action clear.
            </p>
          </div>
        </article>
        <article id="for-whom">
          <h2>Who it is for</h2>
          <div>
            <p>
              Exporters, importers, machinery buyers, companies exploring a new market and
              organisations running business delegations.
            </p>
            <dl>
              {useCases.map(([title, text]) => (
                <div key={title}>
                  <dt>
                    <strong>{title}</strong>
                  </dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </article>
        <article id="how">
          <h2>How the work progresses</h2>
          <div>
            <ol>
              {missionProcess.map(([title, text]) => (
                <li key={title}>
                  <strong>{title}.</strong> {text}
                </li>
              ))}
            </ol>
            <p>
              <Link className="text-link" prefetch={false} href="/how-it-works">
                See how a mission works
              </Link>
            </p>
          </div>
        </article>
        <article id="where">
          <h2>Where we focus</h2>
          <div>
            <p>
              The first priority is Bangladesh to China sourcing and business delegations.
              Bangladesh, Spain and wider European market relationships form part of the product
              direction.
            </p>
            <p>
              Each route needs its own reviewed scope and delivery capacity. A route listed on this
              website does not mean every service is available there. We confirm fit for the
              specific request.
            </p>
            <p>
              <Link className="text-link" prefetch={false} href="/corridors">
                Explore the routes
              </Link>
            </p>
          </div>
        </article>
        <article id="standards">
          <h2>What makes progress credible</h2>
          <div>
            <p>
              Keep the original statement, its source and any supporting evidence together. Say what
              was checked, what is uncertain and what needs a decision.
            </p>
            <p>
              A company’s statement is self-declared until it is checked through a defined process.
              A scheduled meeting is not a meeting held. A proposal is not an order, and an order is
              not cash collected.
            </p>
            <p>
              Corridra supports decisions and execution. It does not guarantee introductions,
              company quality, regulatory approval or commercial results.
            </p>
            <p>
              <Link className="text-link" prefetch={false} href="/trust">
                Read our evidence standards
              </Link>
            </p>
          </div>
        </article>
        <article id="working-together">
          <h2>Working with Corridra</h2>
          <div>
            <p>
              Start with your objective. Corridra reviews the request and proposes the appropriate
              next steps. A submission does not by itself confirm a service commitment.
            </p>
            <p>
              Programme terms and service quotes make scope, fees, responsibilities and exclusions
              explicit. Accepting a quote records an intention to proceed. Online payment is not
              available.
            </p>
            <p>
              {process.env.CORRIDRA_NETWORK_ENABLED === 'true'
                ? 'Reviewed contributors can receive specific execution tasks through Corridra Network. Invitations, eligibility review, task assignment and evidence review remain separate steps. Contributor access does not include the full mission or team workspace.'
                : 'Independent contributor participation remains a controlled expansion plan.'}{' '}
              Broader market coverage remains a controlled expansion plan. We publish no unverified
              client list, network size or success rate.
            </p>
            <p>
              <Link className="text-link" prefetch={false} href="/network">
                Understand Corridra Network and invited work
              </Link>
            </p>
            <p>
              Corridra is operated by Corridra Pte Ltd, 101 Robinson Road, Singapore 180239, with
              operations in Gulshan, Dhaka, Bangladesh. For account or privacy questions, see the{' '}
              <Link className="text-link" prefetch={false} href="/privacy">
                privacy information
              </Link>
              .
            </p>
          </div>
        </article>
      </section>
    </PublicShell>
  );
}
