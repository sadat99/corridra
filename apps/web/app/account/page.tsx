import { WorkspaceShell } from '../../components/workspace-shell';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { neonAuth } from '../../lib/neon-auth';
import { AccountSignout } from './signout';
import { CustomerMissions } from './customer-missions';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your account | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page() {
  const auth = neonAuth();
  if (!auth) redirect('/signin');
  const { data, error } = await auth.getSession({ query: { disableCookieCache: true } });
  if (error)
    return (
      <WorkspaceShell
        eyebrow="YOUR ACCOUNT"
        title="Account access is temporarily unavailable."
        compact
      >
        <p>Please try again in a moment.</p>
        <a className="text-link" href="/account">
          Retry account access
        </a>
        <Link className="text-link" href="/signin">
          Return to sign-in
        </Link>
      </WorkspaceShell>
    );
  if (!data?.user) redirect('/signin');
  if (!data.user.emailVerified)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Verify your email." compact>
        <p>Verify the email address on your account to continue.</p>
        <Link className="primary-link" href="/verify-email">
          Verify email
        </Link>
        <AccountSignout />
      </WorkspaceShell>
    );
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your Corridra account.">
      <div className="ux-account-layout">
        <aside className="ux-account-sidebar" aria-label="Account and access">
          <section className="ux-account-profile" aria-label="Your verified profile">
            <span className="ux-status" data-tone="positive">
              Verified account email
            </span>
            <h2>{data.user.name}</h2>
            <p>{data.user.email}</p>
            <p>
              This verifies account access. It does not verify a company, grant a workspace role or
              admit a real customer mission.
            </p>
          </section>
          <Link className="primary-link" href="/plan">
            Start a test mission brief
          </Link>
          <p>Keep the private receipt supplied with your brief to check its status and replies.</p>
          <nav className="access-options" aria-label="Account sections">
            <a href="#customer-missions">My shared missions</a>
            <Link className="text-link" href="/plan#receipt-check">
              Check a test brief receipt
            </Link>
          </nav>
          <details className="ux-journey-disclosure">
            <summary>Other workspaces and invitations</summary>
            <nav className="access-options" aria-label="Other account access">
              <Link className="text-link" href="/operator/setup">
                Accept a new operator invitation
              </Link>
              <Link className="text-link" href="/workspace">
                Find the right entry
              </Link>
              <Link className="text-link" href="/contributor">
                Assigned-task invitation help
              </Link>
            </nav>
          </details>
          <AccountSignout />
        </aside>
        <div id="customer-missions" tabIndex={-1}>
          <CustomerMissions />
        </div>
      </div>
    </WorkspaceShell>
  );
}
