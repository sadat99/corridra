import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { foundations } from '../../lib/foundations';
import { Workspace } from './workspace';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Operator workspace | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page() {
  const s = foundations();
  if (!s) notFound();
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity) redirect('/operator/signin');
  const tenants = await s.access.tenants(identity.token);
  if (tenants.length === 0)
    return (
      <main id="main" tabIndex={-1} className="operator-page">
        <h1>Workspace access is unavailable.</h1>
        <p>Your session needs a current authenticator check and an active membership.</p>
        <Link className="text-link" href="/operator/signin">
          Verify your access
        </Link>
      </main>
    );
  return (
    <main id="main" tabIndex={-1} className="operator-page">
      <p className="label">SYNTHETIC OPERATOR PREVIEW</p>
      <h1>Your workspace.</h1>
      <Workspace tenants={tenants} />
    </main>
  );
}
