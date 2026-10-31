import { PublicShell } from '../../components/public-shell';
import { Arrow } from '../../components/arrow';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { readNeonAuthConfig } from '@corridra/config';
import { AccountAccess } from '../../components/account-access';
import { accountAccessPath, accountReturnTo } from '../../lib/account-return';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Sign in | Corridra',
  robots: { index: false, follow: true },
};
type Query = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : null);

/**
 * `/signin?next=<path>` (CQ-45): a page that needs sign-in can send the person here with the path they wanted.
 * The path goes through the same reviewed list as `returnTo` (ADR-067): only an exact internal page is kept,
 * anything else falls back to the account. A kept path becomes `returnTo`, which the sign-in form honours.
 */
export default async function Page({ searchParams }: { searchParams?: Promise<Query> }) {
  const query = (await searchParams) ?? {};
  const next = one(query.next);
  if (next !== null && one(query.returnTo) === null) {
    const pulse = process.env.CORRIDRA_PULSE_ENABLED === 'true';
    const kept = accountReturnTo(next, pulse);
    redirect(
      accountAccessPath('/signin', kept, one(query.method) === 'code' ? 'code' : undefined, pulse),
    );
  }
  if (readNeonAuthConfig()) return <AccountAccess title="Sign in to Corridra." mode="signin" />;
  if (process.env.CORRIDRA_FOUNDATIONS_ENABLED === 'true') redirect('/operator/signin');
  return (
    <PublicShell>
      <section className="guide-page-hero">
        <div>
          <p className="label">Coming soon</p>
          <h1>Sign-in is coming soon.</h1>
          <p className="guide-lead">
            Customer sign-in is not switched on here yet. You can still start a request without an
            account. Team members sign in separately.
          </p>
          <div className="guide-page-actions">
            <Link prefetch={false} className="primary-link" href="/plan">
              Start a request without an account
            </Link>
            <Link prefetch={false} className="button-secondary" href="/how-it-works">
              See how Corridra works{' '}
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
