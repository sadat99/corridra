import { PublicShell } from '../../components/public-shell';
import { Arrow } from '../../components/arrow';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountAccess } from '../../components/account-access';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in | Corridra',
  robots: { index: false, follow: true },
};
export default function Page() {
  if (readNeonAuthConfig()) return <AccountAccess title="Sign in to Corridra." mode="signin" />;
  if (process.env.CORRIDRA_FOUNDATIONS_ENABLED === 'true') redirect('/operator/signin');
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <p className="label">COMING SOON</p>
          <h1>Sign-in is coming soon.</h1>
          <p className="guide-lead">
            Customer accounts are not open yet. You can still plan a mission without an account.
            Team members sign in separately.
          </p>
          <div className="guide-page-actions">
            <Link prefetch={false} className="primary-link" href="/plan">
              Prepare an example request without an account
            </Link>
            <Link prefetch={false} className="button-secondary" href="/how-it-works">
              See how Corridra will work{' '}
              <span aria-hidden="true">
                <Arrow />
              </span>
            </Link>
          </div>
        </div>
      </section>
      <nav className="guide-links" aria-label="Other ways in">
        <Link prefetch={false} className="text-link" href="/operator">
          Team sign-in
        </Link>
        <Link prefetch={false} className="text-link" href="/contributor">
          Local helper tasks
        </Link>
        <Link prefetch={false} className="text-link" href="/">
          Back to Corridra
        </Link>
      </nav>
    </PublicShell>
  );
}
