import '../page-budget.css';
import { customerProgrammeProjectionsEnabled } from '@corridra/auth/customer-programme-projections';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerProgrammeContextEnabled } from '@corridra/auth/customer-programme-context';
import { customerMissionSharesEnabled } from '@corridra/auth/customer-mission-shares';
import { customerMissionDraftsEnabled } from '@corridra/auth/customer-mission-drafts';
import { redirect } from 'next/navigation';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammeCoordinationEnabled } from '@corridra/auth/customer-programme-coordination';
import { customerProgrammeTermsEnabled } from '@corridra/auth/customer-programme-terms';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { CustomerShell } from '../../../components/customer-shell';
import { neonAuth } from '../../../lib/neon-auth';
import {
  customerProgrammePagesEnabled,
  programmeAddress,
} from '@corridra/auth/customer-programme-publication';
import { foundations } from '../../../lib/foundations';
import { ParticipantAccount } from './participant-account';
import { ProgrammeApplications, type ApplyTarget } from './programme-applications';
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
// The programme a person chose to apply to, read from its public page. Only what that page shows is passed on.
async function applyTarget(address: string): Promise<ApplyTarget | null> {
  const s = foundations();
  if (!s) return null;
  await s.ready;
  const page = await s.programmePageReader.read(address).catch(() => null);
  if (!page || page.state === 'unknown') return null;
  return {
    address: page.address,
    version: page.version,
    title: page.programme.title,
    organiser: page.programme.organiser,
    open: page.state === 'OPEN',
  };
}
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!customerParticipantsEnabled()) return unavailable();
  const pagesOn = customerProgrammePagesEnabled();
  const asked = pagesOn ? (await searchParams).apply : undefined;
  const address =
    typeof asked === 'string' && programmeAddress.safeParse(asked).success ? asked : null;
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
      <div className="account-compact">
        {pagesOn && (
          <ProgrammeApplications
            subject={session.data.user.id}
            issuer={issuer}
            target={address ? await applyTarget(address) : null}
            asked={typeof asked === 'string'}
          />
        )}
        <ParticipantAccount
          contextEnabled={customerProgrammeContextEnabled()}
          missionSharesEnabled={customerMissionSharesEnabled()}
          coordinationEnabled={customerProgrammeCoordinationEnabled()}
          termsEnabled={customerProgrammeTermsEnabled()}
          projectionsEnabled={customerProgrammeProjectionsEnabled()}
          objectivePathEnabled={pagesOn && customerMissionSharesEnabled()}
          draftsEnabled={customerMissionDraftsEnabled()}
          subject={session.data.user.id}
          issuer={issuer}
        />
      </div>
    </CustomerShell>
  );
}
