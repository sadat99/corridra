import Link from 'next/link';
import { foundations } from '../../../lib/foundations';
import { OperatorSignin } from './signin-form';
import { operatorReturnTo } from '../../../lib/workspace-navigation';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator sign-in | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = (await searchParams).next;
  const returnTo = operatorReturnTo(next);
  if (!foundations())
    return (
      <main id="main" tabIndex={-1} className="operator-page">
        <h1>Workspace sign-in is unavailable.</h1>
        <p>Workspace access is not configured here. This page does not collect credentials.</p>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </main>
    );
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">OPERATOR ACCESS</p>
      <h1>Sign in to your workspace.</h1>
      <OperatorSignin returnTo={returnTo} />
      <nav className="access-options" aria-label="Sign-in alternatives">
        <Link className="text-link" href="/operator/setup">
          Set up invited operator access
        </Link>
        <Link className="text-link" href="/workspace">
          All workspaces and tools
        </Link>
        <Link className="text-link" href="/signin">
          Customer account sign-in
        </Link>
        <Link className="text-link" href="/contributor">
          Assigned-task invitation help
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </nav>
    </main>
  );
}
