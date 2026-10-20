import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { CustomerShell } from '../../../../components/customer-shell';
import { neonAuth } from '../../../../lib/neon-auth';
import { OrganisationProfile } from '../organisation-profile';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Sample company profile | Corridra',
  robots: { index: false, follow: false },
};
function unavailable(message = 'Sample company profile is unavailable.') {
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Sample company profile" compact>
      <p role="status">{message}</p>
      <a className="text-link" href="/account">
        Return to your account
      </a>
    </WorkspaceShell>
  );
}
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (!customerOrganisationProfilesEnabled()) return unavailable();
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
  return (
    <CustomerShell tab="work" eyebrow="SYNTHETIC WORKSPACE" title="Your sample company profile">
      <OrganisationProfile subject={session.data.user.id} issuer={issuer} workspaceId={id.data} />
    </CustomerShell>
  );
}
