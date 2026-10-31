import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerProgrammeContextEnabled } from '@corridra/auth/customer-programme-context';
import { customerMissionSharesEnabled } from '@corridra/auth/customer-mission-shares';
import { redirect } from 'next/navigation';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammeCoordinationEnabled } from '@corridra/auth/customer-programme-coordination';
import { customerProgrammeTermsEnabled } from '@corridra/auth/customer-programme-terms';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { CustomerShell } from '../../../components/customer-shell';
import { neonAuth } from '../../../lib/neon-auth';
import { ParticipantAccount } from './participant-account';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Delegation registrations | Corridra',
  robots: { index: false, follow: false },
};
function unavailable(
  message = realCustomerInput()
    ? 'Delegation participation is unavailable.'
    : 'Sample delegation participation is unavailable.',
) {
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Delegation registrations" compact>
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
  if (!session.data?.user) redirect(`/signin?next=${encodeURIComponent('/account/delegations')}`);
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return (
    <CustomerShell tab="work" eyebrow="REQUESTS" title="Delegation registrations">
      <ParticipantAccount
        contextEnabled={customerProgrammeContextEnabled()}
        missionSharesEnabled={customerMissionSharesEnabled()}
        coordinationEnabled={customerProgrammeCoordinationEnabled()}
        termsEnabled={customerProgrammeTermsEnabled()}
        subject={session.data.user.id}
        issuer={issuer}
      />
    </CustomerShell>
  );
}
