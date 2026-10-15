import Link from 'next/link';
import { WorkspaceShell } from '../../components/workspace-shell';
import { StatusBadge } from '../../components/access-state';
import { operatorEntry, workspaceSections } from '../../lib/workspace-navigation';
import { JourneyDisclosure } from '../../components/journey-disclosure';

export const metadata = {
  title: 'Platform access and tools | Corridra',
  description:
    'Find your customer, operator, administrator or contributor workspace and understand current availability.',
};

export default function Page() {
  return (
    <WorkspaceShell eyebrow="START HERE" title="What would you like to do?">
      <div className="platform-access">
        <StatusBadge tone="caution">Synthetic mission operations</StatusBadge>
        <p>
          Corridra helps you organise work to find buyers, source suppliers or enter a market. A
          mission keeps the objective, supporting evidence and next action together. You can explore
          an example or prepare an example request before signing in.
        </p>
        <nav className="workspace-navigation" aria-label="Platform access sections">
          <a href="#access-roles">Open existing work</a>
          <a href="#access-tools">All operator tools</a>
          <a href="#access-readiness">What is available now</a>
        </nav>
        <section aria-label="Getting started" className="ux-start-paths">
          <div className="detail-grid access-cards">
            <article className="detail-card">
              <p className="label">1. UNDERSTAND THE PROCESS</p>
              <h2>See a mission in action</h2>
              <p>
                Follow an invented example from an objective to evidence and a next step. No account
                needed.
              </p>
              <Link className="primary-link" href="/#mission-example">
                Explore the example
              </Link>
            </article>
            <article className="detail-card">
              <p className="label">2. DESCRIBE YOUR OBJECTIVE</p>
              <h2>Prepare an example request</h2>
              <p>
                Choose what you need, the commercial direction and the details for review. Use
                invented records only.
              </p>
              <Link className="primary-link" href="/plan">
                Prepare my example request
              </Link>
            </article>
            <article className="detail-card">
              <p className="label">ALREADY WORKING WITH US?</p>
              <h2>Continue your work</h2>
              <p>
                Open your account, invited operator workspace or private sharing link. Choose the
                access you already have.
              </p>
              <a className="primary-link" href="#access-roles">
                Find my existing work
              </a>
            </article>
          </div>
        </section>
        <JourneyDisclosure id="access-roles" title="Open your existing work">
          <h2>Use the access you already have</h2>
          <p>
            Customer accounts and invited operator accounts have separate passwords. A private
            mission or programme link opens only the information shared with you.
          </p>
          <div className="detail-grid access-cards">
            <article className="detail-card">
              <h3>Customer or company</h3>
              <p>
                Exporters, buyers, importers, machinery purchasers and market-entry customers use a
                verified customer account. Mission details need an assigned private invitation.
              </p>
              <Link className="primary-link" href="/account">
                Open customer account
              </Link>
              <p>
                <Link className="text-link" href="/plan">
                  Create a test mission request
                </Link>
              </p>
              <p>
                <Link className="text-link" href="/plan#receipt-check">
                  Check a private test receipt
                </Link>
              </p>
            </article>
            <article className="detail-card">
              <h3>Operator, founder or administrator</h3>
              <p>
                Use your invited operator account, authenticator and workspace membership. A
                customer signup does not create an operator account or grant admin access.
              </p>
              <Link className="primary-link" href="/operator">
                Open operator workspace
              </Link>
              <p>
                <Link className="text-link" href="/operator/setup">
                  Accept a new operator invitation
                </Link>
              </p>
              <p>
                <a className="text-link" href="#access-tools">
                  Choose a specific tool
                </a>
              </p>
            </article>
            <article className="detail-card">
              <h3>Institution or delegation</h3>
              <p>
                Programme leaders and participants receive private links with their assigned scope.
                A public programme page cannot reveal a private programme.
              </p>
              <Link className="primary-link" href="/programme">
                Programme invitation help
              </Link>
              <p>
                <Link className="text-link" href="/institutions">
                  Institution services
                </Link>
              </p>
              <p>
                <Link className="text-link" href="/business-trips">
                  Trips and delegations
                </Link>
              </p>
            </article>
            <article className="detail-card">
              <h3>Supplier or local contributor</h3>
              <p>
                Suppliers use their private request link. Contributors use an assigned-task
                invitation and invited identity. Neither grants access to the operator workspace.
              </p>
              <Link className="primary-link" href="/contributor">
                Assigned-task access
              </Link>
              <p>
                <Link className="text-link" href="/buyer">
                  Supplier and buyer invitation help
                </Link>
              </p>
            </article>
          </div>
        </JourneyDisclosure>
        <JourneyDisclosure id="access-tools" title="All operator tools and settings">
          <h2>Operator tool directory</h2>
          <p>
            These links preserve the selected tool through operator sign-in and MFA. Your membership
            determines which tools open. Empty records mean there is no accessible recorded data;
            they do not grant permission to create real customer data.
          </p>
          <div className="detail-grid access-cards">
            {workspaceSections
              .filter((section) => section.part !== 'Access')
              .map((section) => (
                <article className="detail-card" key={section.id}>
                  <h3>{section.label}</h3>
                  <p>Workspace roles: {section.roles.join(', ')}.</p>
                  <Link className="text-link" prefetch={false} href={operatorEntry(section.id)}>
                    Open {section.label.toLowerCase()}
                  </Link>
                </article>
              ))}
          </div>
        </JourneyDisclosure>
        <JourneyDisclosure id="access-readiness" title="What is available now">
          <h2>Current availability</h2>
          <p>
            Current mission operation is synthetic. Use invented records only. Account signup is
            available separately; it does not activate real mission intake, outreach, payments or
            customer evidence uploads.
          </p>
          <p>
            AI and the contributor network are deployed but production activation is off. Do not
            enter provider API keys in forms. Route configuration alone does not authorize delivery.
          </p>
          <ol>
            <li>
              For operator access, obtain an invitation and workspace membership from your workspace
              owner, then complete authenticator verification.
            </li>
            <li>
              For customer, supplier or programme details, use the private link supplied by the
              operator. Signing up alone does not reveal a mission.
            </li>
            <li>
              Owners and admins can review route evidence and production prerequisites in Global
              Operations. Missing legal, storage, scanner, provider or pilot approvals remain
              blocked.
            </li>
          </ol>
          <Link className="text-link" href={operatorEntry('ops-gates')}>
            Review production readiness
          </Link>
          <p>
            <Link className="text-link" href="/trust">
              Trust and evidence
            </Link>{' '}
            ·{' '}
            <Link className="text-link" href="/privacy">
              Account and test intake notice
            </Link>
          </p>
        </JourneyDisclosure>
        <nav className="workspace-navigation" aria-label="Platform return links">
          <Link href="/">Back to Corridra</Link>
          <a href="#access-roles">Open existing work</a>
        </nav>
      </div>
    </WorkspaceShell>
  );
}
