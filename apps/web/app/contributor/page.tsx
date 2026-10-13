import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { foundations } from '../../lib/foundations';
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
  if (!s) notFound();
  const workspace = z.uuid().safeParse((await searchParams).workspace);
  if (!workspace.success)
    return (
      <main id="main" className="operator-page">
        <h1>Your assigned tasks.</h1>
        <p>Open the workspace link supplied with your reviewed invitation.</p>
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
      <Link className="text-link" href="/operator/signin">
        Verify your authenticator again
      </Link>
    </main>
  );
}
