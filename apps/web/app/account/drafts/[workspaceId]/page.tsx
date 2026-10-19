import { customerMissionDraftsEnabled } from '@corridra/auth/customer-mission-drafts';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { neonAuth } from '../../../../lib/neon-auth';
import { foundations } from '../../../../lib/foundations';
import { GuidedRequest } from '../guided-request';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Guided sample request | Corridra',
  robots: { index: false, follow: false },
};
function unavailable(message = 'Guided sample requests are unavailable.') {
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Guided sample request" compact>
      <p role="status">{message}</p>
      <a className="text-link" href="/account">
        Return to your account
      </a>
    </WorkspaceShell>
  );
}
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  // A closed gate must not read provider state, optional schema or private data.
  if (!customerMissionDraftsEnabled()) return unavailable();
  const id = z.uuid().safeParse((await params).workspaceId);
  if (!id.success) notFound();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth) return unavailable();
  const session = await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!session || session.error)
    return unavailable('Your account could not be checked. Return to your account and try again.');
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  const services = foundations();
  if (!services) return unavailable();
  let name: string;
  try {
    await services.ready;
    // Request admission and active membership are checked from fresh server proofs, not browser props.
    await services.customerMissionDrafts.list(
      { workspaceId: id.data },
      session.data.user.id,
      issuer,
    );
    const workspaces = await services.customerWorkspaces.list(session.data.user.id, issuer);
    const selected = workspaces.find((workspace) => workspace.id === id.data);
    if (!selected) return unavailable('Access to this workspace could not be confirmed.');
    name = selected.name;
  } catch {
    return unavailable('Access could not be confirmed. Reload your account before continuing.');
  }
  return (
    <WorkspaceShell eyebrow="SYNTHETIC WORKSPACE" title="Start a request">
      <p>Workspace: {name}</p>
      <GuidedRequest
        subject={session.data.user.id}
        issuer={issuer}
        workspaceId={id.data}
        profilesEnabled={customerOrganisationProfilesEnabled()}
      />
    </WorkspaceShell>
  );
}
