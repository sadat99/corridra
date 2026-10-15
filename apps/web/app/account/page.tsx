import { WorkspaceShell } from '../../components/workspace-shell';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { neonAuth } from '../../lib/neon-auth';
import { AccountSignout } from './signout';
import { CustomerMissions } from './customer-missions';
import { OperatorInvitationHint } from '../../components/operator-invitation-hint';
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
            <p>Your email address is verified. This does not verify your company.</p>
          </section>
          <OperatorInvitationHint key={data.user.id} />
          <Link className="primary-link" href="/plan">
            Plan a mission
          </Link>
          <p>
            Keep the receipt we give you after you send a request. You can use it to check progress
            and replies.
          </p>
          <nav className="access-options" aria-label="Account sections">
            <a href="#customer-missions">My shared missions</a>
            <Link className="text-link" href="/plan#receipt-check">
              Check a request receipt
            </Link>
          </nav>
          <details className="ux-journey-disclosure">
            <summary>Other ways in</summary>
            <nav className="access-options" aria-label="Other account access">
              <Link className="text-link" href="/operator/setup">
                Accept a team invitation
              </Link>
              <Link className="text-link" href="/workspace">
                Start page
              </Link>
              <Link className="text-link" href="/contributor">
                Local helper tasks
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
