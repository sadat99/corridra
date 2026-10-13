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
    <main id="main" tabIndex={-1}>
      <section className="page-hero status-page">
        <p className="label">COMING SOON</p>
        <h1>Sign-in is coming soon.</h1>
        <p className="page-description">
          Accounts are not available yet. This page does not collect credentials. The public pages
          explain what we’re building while the protected workspace is prepared.
        </p>
        <div className="hero-actions">
          <Link prefetch={false} className="primary-link" href="/how-it-works">
            See how Corridra will work{' '}
            <span aria-hidden="true">
              <Arrow />
            </span>
          </Link>
          <Link prefetch={false} className="text-link" href="/operator">
            Invited operator access
          </Link>
          <Link prefetch={false} className="text-link" href="/contributor">
            Assigned-task invitation help
          </Link>
          <Link prefetch={false} className="text-link" href="/">
            Back to Corridra
          </Link>
        </div>
      </section>
    </main>
  );
}
