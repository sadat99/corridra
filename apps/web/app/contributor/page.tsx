import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { foundations } from '../../lib/foundations';
import { ContributorSignout } from './signout';
import { TaskBoard } from './task-board';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your assigned tasks | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const s = foundations();
  if (!s)
    return (
      <main id="main" tabIndex={-1} className="operator-page">
        <h1>Your assigned tasks.</h1>
        <p>
          Assigned-task access is not configured in this environment. Keep the invitation supplied
          by your operator.
        </p>
        <Link className="text-link" href="/network">
          How assigned work works
        </Link>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </main>
    );
  const workspace = z.uuid().safeParse((await searchParams).workspace);
  if (!workspace.success)
    return (
      <main id="main" className="operator-page">
        <h1>Your assigned tasks.</h1>
        <p>
          Open the workspace link supplied with your reviewed invitation. A customer account does
          not grant assigned-task access.
        </p>
        <Link className="text-link" href="/network">
          How assigned work works
        </Link>
        <Link className="text-link" href="/signin">
          Choose your sign-in route
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </main>
    );
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity)
    redirect(
      '/operator/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace.data),
    );
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">ASSIGNED EXECUTION WORK</p>
      <h1>Your assigned tasks.</h1>
      <p>
        Only your disclosed tasks appear here. Use synthetic records until pilot controls are
        accepted.
      </p>
      {process.env.CORRIDRA_NETWORK_ENABLED === 'true' ? (
        <TaskBoard workspace={workspace.data} />
      ) : (
        <p>The execution network is awaiting activation review. No work is currently available.</p>
      )}
      <Link
        className="text-link"
        href={
          '/operator/signin?next=' + encodeURIComponent('/contributor?workspace=' + workspace.data)
        }
        target="_blank"
        rel="noopener noreferrer"
      >
        Verify your authenticator again (opens a new tab)
      </Link>
      <p>Keep this task page open while verifying so unreceived work remains available to retry.</p>
      <Link className="text-link" href="/network">
        About assigned work
      </Link>
      {process.env.CORRIDRA_NETWORK_ENABLED !== 'true' && <ContributorSignout />}
    </main>
  );
}
