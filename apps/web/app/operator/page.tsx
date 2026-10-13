import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { foundations } from '../../lib/foundations';
import { Workspace } from './workspace';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator workspace | Corridra',
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
        <h1>Workspace access is unavailable.</h1>
        <p>The protected workspace is not configured in this environment.</p>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/">
          Back to Corridra
        </Link>
      </main>
    );
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity) redirect('/operator/signin');
  const tenants = await s.access.tenants(identity.token);
  const requested = (await searchParams).workspace;
  const selected = tenants.find((t) => t.id === requested)?.id ?? tenants[0]?.id;
  if (tenants.length === 0)
    return (
      <main id="main" tabIndex={-1} className="operator-page">
        <h1>Workspace access is unavailable.</h1>
        <p>Your session needs a current authenticator check and an active membership.</p>
        <p>
          Invited contributors use their assigned-task link, which does not grant workspace
          membership.
        </p>
        <Link className="text-link" href="/contributor">
          Assigned-task invitation help
        </Link>
        <Link className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link className="text-link" href="/operator/signin">
          Verify your access
        </Link>
      </main>
    );
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">OPERATOR WORKSPACE</p>
      <h1>Your workspace.</h1>
      <Workspace tenants={tenants} initialTenant={selected!} />
    </main>
  );
}
