import Link from 'next/link';
import { operatorEntry, workspaceSections } from '../../lib/workspace-navigation';

export const metadata = {
  title: 'Platform access and tools | Corridra',
  description:
    'Find your customer, operator, administrator or contributor workspace and understand current availability.',
};

export default function Page() {
  return (
    <main id="main" tabIndex={-1} className="operator-page platform-access">
      <p className="label">PLATFORM ACCESS</p>
      <h1>Find your Corridra workspace.</h1>
      <p>
        Choose your role, then open the tools you need. Customer accounts and invited operator
        accounts have separate sign-in and permissions.
      </p>
      <nav className="workspace-navigation" aria-label="Platform access sections">
        <a href="#access-roles">Choose your access</a>
        <a href="#access-tools">Explore V2 tools</a>
        <a href="#access-readiness">Availability and prerequisites</a>
      </nav>
      <section id="access-roles" tabIndex={-1}>
        <h2>Choose your access</h2>
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
                Create a test mission brief
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
              Use your invited operator account, authenticator and workspace membership. A customer
              signup does not create an operator account or grant admin access.
            </p>
            <Link className="primary-link" href="/operator">
              Open operator workspace
            </Link>
            <p>
              <a className="text-link" href="#access-tools">
                Choose a specific tool
              </a>
            </p>
          </article>
          <article className="detail-card">
            <h3>Institution or delegation</h3>
            <p>
              Programme leaders and participants receive private links with their assigned scope. A
              public programme page cannot reveal a private programme.
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
              Suppliers use their private request link. Contributors use an assigned-task invitation
              and invited identity. Neither grants access to the operator workspace.
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
      </section>
      <section id="access-tools" tabIndex={-1}>
        <h2>Explore the V2 tools</h2>
        <p>
          These links preserve the selected tool through operator sign-in and MFA. Your membership
          determines which tools open. Empty records mean there is no accessible recorded data; they
          do not grant permission to create real customer data.
        </p>
        <div className="detail-grid access-cards">
          {workspaceSections
            .filter((section) => section.part !== 'Access')
            .map((section) => (
              <article className="detail-card" key={section.id}>
                <p className="label">{section.part}</p>
                <h3>{section.label}</h3>
                <p>Workspace roles: {section.roles.join(', ')}.</p>
                <Link className="text-link" prefetch={false} href={operatorEntry(section.id)}>
                  Open {section.label.toLowerCase()}
                </Link>
              </article>
            ))}
        </div>
      </section>
      <section id="access-readiness" tabIndex={-1}>
        <h2>Availability and prerequisites</h2>
        <p>
          Current mission operation is synthetic. Use invented records only. Account signup is
          available separately; it does not activate real mission intake, outreach, payments or
          customer evidence uploads.
        </p>
        <p>
          AI and the contributor network are deployed but production activation is off. Do not enter
          provider API keys in forms. Route configuration alone does not authorize delivery.
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
            Operations. Missing legal, storage, scanner, provider or pilot approvals remain blocked.
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
      </section>
      <nav className="workspace-navigation" aria-label="Platform return links">
        <Link href="/">Back to Corridra</Link>
        <a href="#access-roles">Back to access choices</a>
      </nav>
    </main>
  );
}
