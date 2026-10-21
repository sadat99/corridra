import { z } from 'zod';
import { redirect, notFound } from 'next/navigation';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { CustomerShell } from '../../../../components/customer-shell';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { readNeonAuthConfig } from '@corridra/config';
import { neonAuth } from '../../../../lib/neon-auth';
import { foundations } from '../../../../lib/foundations';
import { PrivateRequestIntake } from '../private-request-intake';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Private sample request | Corridra',
  robots: { index: false, follow: false },
};
function unavailable(message = 'Private sample requests are unavailable.') {
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Private sample request" compact>
      <p role="status">{message}</p>
      <a className="text-link" href="/account">
        Return to your account
      </a>
    </WorkspaceShell>
  );
}
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  // A closed gate must not read provider state, optional schema or private data.
  if (!customerRequestsEnabled() || !customerWorkspacesEnabled()) return unavailable();
  const id = z.uuid().safeParse((await params).workspaceId);
  if (!id.success) notFound();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth) return unavailable();
  const session = await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!session || session.error)
    return unavailable('Your account could not be checked. Please try again.');
  const { data } = session;
  if (!data?.user) redirect('/signin');
  if (data.user.emailVerified !== true) redirect('/verify-email');
  const services = foundations();
  if (!services) return unavailable();
  let name: string;
  try {
    await services.ready;
    // Independent request admission and selected workspace membership are both
    // checked using fresh server proofs; neither browser props nor email grant it.
    await services.customerRequests.list({ pageSize: 1 }, data.user.id, issuer);
    const workspaces = await services.customerWorkspaces.list(data.user.id, issuer);
    const selected = workspaces.find((workspace) => workspace.id === id.data);
    if (!selected)
      return unavailable('Private request access for this workspace could not be confirmed.');
    name = selected.name;
  } catch {
    return unavailable(
      'Private request access could not be confirmed. Reload your account before continuing.',
    );
  }
  return (
    <CustomerShell tab="work" eyebrow="MY WORK" title="What do you want to achieve?">
      <p>Workspace: {name}</p>
      <PrivateRequestIntake issuer={issuer} subject={data.user.id} workspaceId={id.data} />
    </CustomerShell>
  );
}
