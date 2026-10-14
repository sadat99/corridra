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
      <main id="main" tabIndex={-1} className="operator-page">
        <h1>Account access is temporarily unavailable.</h1>
        <p>Please try again in a moment.</p>
        <Link className="text-link" href="/account">
          Retry account access
        </Link>
        <Link className="text-link" href="/signin">
          Return to sign-in
        </Link>
      </main>
    );
  if (!data?.user) redirect('/signin');
  if (!data.user.emailVerified)
    return (
      <main id="main" tabIndex={-1} className="operator-page">
        <h1>Verify your email.</h1>
        <p>Verify the email address on your account to continue.</p>
        <Link className="primary-link" href="/verify-email">
          Verify email
        </Link>
        <AccountSignout />
      </main>
    );
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">YOUR ACCOUNT</p>
      <h1>Your Corridra account.</h1>
      <p>{data.user.name}</p>
      <p>{data.user.email}</p>
      <Link className="primary-link" href="/plan">
        Start a mission brief
      </Link>
      <p>Keep the private receipt supplied with your brief to check its status and replies.</p>
      <nav className="access-options" aria-label="Account sections">
        <Link className="text-link" href="/workspace">
          All workspaces and tools
        </Link>
        <a href="#customer-missions">My shared missions</a>
        <Link className="text-link" href="/plan#receipt-check">
          Check a test brief receipt
        </Link>
        <Link className="text-link" href="/contributor">
          Assigned-task invitation help
        </Link>
      </nav>
      <div id="customer-missions" tabIndex={-1}>
        <CustomerMissions />
      </div>
      <AccountSignout />
    </main>
  );
}
