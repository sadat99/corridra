import Link from 'next/link';
import type { ReactNode } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { FactLabel } from '../../components/fact-label';
import { PublicShell } from '../../components/public-shell';
import { roadSteps, type RoadStep } from '../../components/mr/road-status';
import { roadStepNames } from '../../lib/ux/customer-road';
import { OpenFromHash } from './open-from-hash';
import './about.css';

export const metadata = {
  title: 'About Corridra | Commercial progress across borders',
  description:
    'What Corridra does, who it serves, how a mission works and how commercial progress is assessed.',
};

// The About page, Editorial layout (owner decision of 6 November 2026, docs/revamp/specs/layout-budget.md).
// One page with no tabs: the opening, who it is for and the six steps show in full; the last three sections show
// their key line and keep the supporting detail behind a native Show Details. Every word stays in the server HTML.

const useCases = [
  [
    'Find buyers and partners',
    'Exporters and companies entering a market',
    'choose the right company. Explain your offer. Plan useful conversations.',
  ],
  [
    'Source products and machinery',
    'Importers and purchasing teams',
    'list what you need to buy. Ask suppliers questions and compare them. Plan visits with a clear purpose.',
  ],
  [
    'Make a business visit count',
    'Companies preparing a trade fair, factory visit or market visit',
    'agree your goals before you travel. Follow up after the meetings.',
  ],
  [
    'Run a delegation or programme',
    'Chambers, institutions and organisers',
    'manage the programme. Keep each person’s goals and private information apart.',
  ],
] as const;

// The customer road (D5): the step names are the shared ones the home page, How it works and the account use.
const stepText: Record<RoadStep, string> = {
  define: 'Tell us the market, the commercial need and what would make it worthwhile.',
  find: 'We research companies that could fit and agree scope and any fees with you first.',
  compare: 'Companies and offers side by side, with what is claimed and what is checked.',
  visit: 'We prepare introductions. We organise the meetings and visits you agree.',
  decide: 'Choose who to work with, with the evidence and open questions in view.',
  follow: 'Next action, owner and evidence stay with the work until a result.',
};

const networkText =
  process.env.CORRIDRA_NETWORK_ENABLED === 'true'
    ? 'Reviewed contributors can receive specific execution tasks through Corridra Network. Invitations, eligibility review, task assignment and evidence review remain separate steps. Contributor access does not include the full mission or team workspace.'
    : 'Independent contributor participation remains a controlled expansion plan.';

/**
 * A section of the closing band: its key line, the essentials, the supporting detail behind Show Details, and its
 * link. On a wide screen the essentials show under the key line and the link sits beside Show Details. On a phone
 * Show Details is the round control beside the heading, and the essentials and the link open with the detail.
 */
function Section({
  id,
  title,
  lead,
  essentials,
  detail,
  link,
}: {
  id: string;
  title: string;
  lead: ReactNode;
  essentials?: ReactNode;
  detail: ReactNode;
  link: { href: string; label: string };
}) {
  const linkTo = (className: string) => (
    <Link className={className} prefetch={false} href={link.href}>
      {link.label}
    </Link>
  );
  return (
    <article id={id} className="about-section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {lead}
      {essentials ? <div className="about-essentials about-wide-only">{essentials}</div> : null}
      <div className="about-tail">
        <details className="about-more">
          <summary aria-describedby={`${id}-title`}>
            <span className="about-more-show">Show Details</span>
            <span className="about-more-hide">Hide Details</span>
          </summary>
          <div className="about-more-body">
            {essentials ? (
              <div className="about-essentials about-phone-only">{essentials}</div>
            ) : null}
            {detail}
            <p className="about-phone-only">{linkTo('about-quiet')}</p>
          </div>
        </details>
        {linkTo('about-quiet about-wide-only')}
      </div>
    </article>
  );
}

/** An opening section: open on a wide screen, folded under its heading on a phone. */
function Opening({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <article id={id} className="about-opening" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <details className="about-fold">
        <summary aria-describedby={`${id}-title`}>
          <span className="sr-only">Show Details</span>
        </summary>
        <div className="about-fold-body">{children}</div>
      </details>
    </article>
  );
}

export default function Page() {
  return (
    <PublicShell className="about-page">
      <OpenFromHash />
      <section className="about-band" aria-labelledby="about-title">
        <div className="about-top">
          <div className="about-intro">
            <nav className="guide-crumb" aria-label="Breadcrumb">
              <Link prefetch={false} href="/">
                Corridra
              </Link>
              <span aria-hidden="true">/</span>
              <span aria-current="page">About</span>
            </nav>
            <h1 id="about-title">Make market entry deliberate.</h1>
            <p className="about-lead">
              Corridra helps companies turn a cross-border commercial objective into planned work,
              relevant relationships and accountable follow-through.
            </p>
            <div className="about-actions">
              <Link className="primary-link" prefetch={false} href="/plan">
                Start a Request
              </Link>
              <a className="about-quiet about-wide-only" href="#how">
                See the Six Steps
              </a>
            </div>
          </div>
          <Opening id="why" title="Why Corridra exists">
            <p>
              A contact list is a starting point. A business trip is an opportunity. Neither tells
              you which company fits, what is known or who will take the next step.
            </p>
            <p>
              Corridra brings that work together: a clear objective, relevant company context,
              practical coordination and a record of what happened.
            </p>
          </Opening>
          <Opening id="what" title="What a mission means">
            <p>
              A mission is a planned piece of work to meet the right companies and advance a
              commercial objective.
            </p>
            <p>
              It can support a buying decision, a market-entry effort or a group programme. The
              request, company context, tasks, evidence and progress belong to the same working
              record. The aim is to make the next useful action clear.
            </p>
          </Opening>
        </div>

        <section id="for-whom" className="about-block" aria-labelledby="for-whom-title">
          <div className="about-head">
            <h2 id="for-whom-title">Who it is for</h2>
            <p>
              Exporters, importers, machinery buyers, companies exploring a new market and
              organisations running business delegations.
            </p>
          </div>
          <ul className="about-uses" tabIndex={0} aria-label="Four kinds of work">
            {useCases.map(([title, who, what]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>
                  <strong>{who}:</strong> {what}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" className="about-block" aria-labelledby="how-title">
          <div className="about-head">
            <h2 id="how-title">How the work progresses</h2>
            <Link className="about-quiet" prefetch={false} href="/how-it-works">
              See How a Mission Works
            </Link>
          </div>
          <ol className="about-road">
            {roadSteps.map((step, index) => (
              <li key={step}>
                <span className="about-road-dot" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{roadStepNames[step]}</h3>
                <p>{stepText[step]}</p>
              </li>
            ))}
          </ol>
        </section>
      </section>

      <div className="about-close">
        <Section
          id="where"
          title="Where we focus"
          lead={
            <p className="about-key">
              <strong>First priority: Bangladesh to China</strong> sourcing and business
              delegations. A listed route does not mean every service is available there. We confirm
              fit for each request.
            </p>
          }
          detail={
            <p>
              Bangladesh, Spain and wider European market relationships form part of the product
              direction. Each route needs its own reviewed scope and delivery capacity.
            </p>
          }
          link={{ href: '/corridors', label: 'Explore the Routes' }}
        />
        <Section
          id="standards"
          title="What makes progress credible"
          lead={
            <p className="about-isnot">
              A scheduled meeting is not a meeting held. A proposal is not an order, and an order is
              not cash collected.
            </p>
          }
          essentials={
            <>
              <ol className="about-rungs" aria-label="From claim to decision">
                <li>
                  <b>Claim</b>
                  <FactLabel label="Self-declared" />
                </li>
                <li>
                  <b>Checked</b>
                  <FactLabel label="Verified" />
                </li>
                <li>
                  <b>Decision</b>
                  <span>Kept in view</span>
                </li>
              </ol>
              <p>
                Corridra supports decisions and execution. It does not guarantee introductions,
                company quality, regulatory approval or commercial results.
              </p>
            </>
          }
          detail={
            <ol className="about-ladder" aria-label="What each step means">
              <li>
                <b>Claim</b>
                <p>
                  The original statement stays with its source and any supporting evidence. A
                  company’s statement is <FactLabel label="Self-declared" /> until it is checked
                  through a defined process.
                </p>
              </li>
              <li>
                <b>Checked</b>
                <p>
                  We say what was checked and what is uncertain:{' '}
                  <FactLabel label="Evidence available" /> <FactLabel label="Verified" />{' '}
                  {/* The unanswered-fact state, in English on this English page (NotConfirmedLabel follows the
                      chosen language). */}
                  <span className="guide-tag" data-tone="unknown">
                    <CorridraIcon name="help" />
                    Not confirmed
                  </span>
                </p>
              </li>
              <li>
                <b>Decision</b>
                <p>What needs a decision stays in view.</p>
              </li>
            </ol>
          }
          link={{ href: '/trust', label: 'Read Our Evidence Standards' }}
        />
        <Section
          id="working-together"
          title="Working with Corridra"
          lead={
            <p className="about-key">
              <strong>We publish no unverified client list, network size or success rate.</strong>
            </p>
          }
          essentials={
            <p>
              Start with your objective. A submission does not by itself confirm a service
              commitment. Online payment is not available.
            </p>
          }
          detail={
            <dl className="about-terms">
              <div>
                <dt>Review</dt>
                <dd>Corridra reviews the request and proposes the appropriate next steps.</dd>
              </div>
              <div>
                <dt>Quote</dt>
                <dd>
                  Programme terms and service quotes make scope, fees, responsibilities and
                  exclusions explicit. Accepting a quote records an intention to proceed.
                </dd>
              </div>
              <div>
                <dt>Growth</dt>
                <dd>{networkText} Broader market coverage remains a controlled expansion plan.</dd>
              </div>
            </dl>
          }
          link={{ href: '/network', label: 'Understand Corridra Network and Invited Work' }}
        />
        <div className="about-company">
          <p>
            Corridra is operated by Corridra Pte Ltd, 101 Robinson Road, Singapore 180239, with
            operations in Gulshan, Dhaka, Bangladesh. Questions about your account or privacy? See
            the{' '}
            <Link prefetch={false} href="/privacy">
              privacy information
            </Link>
            .
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
