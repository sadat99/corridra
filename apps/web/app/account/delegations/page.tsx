import { customerProgrammeContextEnabled } from '@corridra/auth/customer-programme-context';
import { customerMissionSharesEnabled } from '@corridra/auth/customer-mission-shares';
import { redirect } from 'next/navigation';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { neonAuth } from '../../../lib/neon-auth';
import { ParticipantAccount } from './participant-account';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'My sample delegations | Corridra',
  robots: { index: false, follow: false },
};
function unavailable(message = 'Sample delegation participation is unavailable.') {
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="My sample delegations" compact>
      <p role="status">{message}</p>
      <a className="text-link" href="/account">
        Return to your account
      </a>
    </WorkspaceShell>
  );
}
export default async function Page() {
  if (!customerParticipantsEnabled()) return unavailable();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL,
    auth = neonAuth();
  if (!issuer || !auth) return unavailable();
  const session = await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!session || session.error)
    return unavailable('Your account could not be checked. Return and try again.');
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return (
    <WorkspaceShell eyebrow="SYNTHETIC WORKSPACE" title="My sample delegations">
      <ParticipantAccount
        contextEnabled={customerProgrammeContextEnabled()}
        missionSharesEnabled={customerMissionSharesEnabled()}
        subject={session.data.user.id}
        issuer={issuer}
      />
    </WorkspaceShell>
  );
}
