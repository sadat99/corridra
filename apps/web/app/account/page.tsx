import { AssignedMissions } from './assigned-missions';
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { WorkspaceShell } from '../../components/workspace-shell';
import { CustomerShell } from '../../components/customer-shell';
import { NextStepCard } from '../../components/next-step-card';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { neonAuth } from '../../lib/neon-auth';
import { AccountSignout } from './signout';
import { CustomerMissions } from './customer-missions';
import { SavedMissions } from './saved-missions';
import { customerSavedMissionsEnabled } from '@corridra/auth/customer-saved-missions';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { OperatorInvitationHint } from '../../components/operator-invitation-hint';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { CustomerWorkspaces } from './customer-workspaces';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { customerMissionDraftsEnabled } from '@corridra/auth/customer-mission-drafts';
import { customerMemberRolesEnabled } from '@corridra/auth/customer-member-roles';
import { customerOrganisationLinksEnabled } from '@corridra/auth/customer-organisation-links';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { readNeonAuthConfig } from '@corridra/config';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { missionStatus } from '@corridra/domain/missions';
import { CustomerRequests } from './customer-requests';
import { foundations } from '../../lib/foundations';
import { AccountHashRedirect } from './hash-redirect';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your account | Corridra',
  robots: { index: false, follow: false },
};
const views = ['home', 'work', 'results', 'more'] as const;
type View = (typeof views)[number];
const headings: Record<View, { eyebrow: string; title: string }> = {
  home: { eyebrow: 'YOUR ACCOUNT', title: 'What would you like to do?' },
  work: { eyebrow: 'MY WORK', title: 'Workspaces and requests.' },
  results: { eyebrow: 'RESULTS', title: 'Missions shared with you.' },
  more: { eyebrow: 'MORE', title: 'Your account and help.' },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const requested = (await searchParams).view;
  const view: View = views.find((item) => item === requested) ?? 'home';
  const auth = neonAuth();
  if (!auth) redirect('/signin');
  const { data, error } = await auth.getSession({ query: { disableCookieCache: true } });
  if (error)
    return (
      <WorkspaceShell
        eyebrow="YOUR ACCOUNT"
        title="Account access is temporarily unavailable."
        compact
      >
        <p>Please try again in a moment.</p>
        <a className="text-link" href="/account">
          Retry account access
        </a>
        <Link className="text-link" href="/signin">
          Return to sign-in
        </Link>
      </WorkspaceShell>
    );
  if (!data?.user) redirect('/signin');
  if (!data.user.emailVerified)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Verify your email." compact>
        <p>Verify the email address on your account to continue.</p>
        <Link className="primary-link" href="/verify-email">
          Verify email
        </Link>
        <AccountSignout />
      </WorkspaceShell>
    );
  const workspaceIssuer = customerWorkspacesEnabled()
    ? readNeonAuthConfig()?.NEON_AUTH_BASE_URL
    : undefined;
  const requestIssuer = customerRequestsEnabled()
    ? readNeonAuthConfig()?.NEON_AUTH_BASE_URL
    : undefined;
  const savedMissionIssuer = customerSavedMissionsEnabled()
    ? readNeonAuthConfig()?.NEON_AUTH_BASE_URL
    : undefined;
  let requestCreationEnabled = false;
  if (requestIssuer && workspaceIssuer) {
    const services = foundations();
    if (services)
      try {
        await services.ready;
        await services.customerRequests.list({ pageSize: 1 }, data.user.id, requestIssuer);
        requestCreationEnabled = true;
      } catch {
        /* The independent request section provides the bounded unavailable/denied state. */
      }
  }
  const heading = headings[view];
  return (
    <CustomerShell tab={view} eyebrow={heading.eyebrow} title={heading.title}>
      <AccountHashRedirect view={view} />
      {view === 'home' && (
        <>
          <NextStepCard
            title={requestCreationEnabled ? 'Start a request' : 'Plan a mission'}
            text={
              requestCreationEnabled
                ? 'Choose a workspace, then say what you want to achieve.'
                : 'Tell us your goal. It takes a few minutes.'
            }
            action={requestCreationEnabled ? 'Choose a workspace' : 'Plan a mission'}
            href={requestCreationEnabled ? '/account?view=work#customer-workspaces' : '/plan'}
          />
          <section className="guide-area ux-account-groups" aria-labelledby="open-title">
            <h2 id="open-title">Have something to open?</h2>
            <ul className="ux-quick-links">
              {workspaceIssuer && (
                <li>
                  <Link prefetch={false} href="/account?view=work">
                    <strong>Join a workspace</strong>
                    <span>Use an invitation from a workspace owner.</span>
                  </Link>
                </li>
              )}
              <li>
                <Link prefetch={false} href="/account?view=results">
                  <strong>Open a shared mission</strong>
                  <span>Paste the private link you were sent.</span>
                </Link>
              </li>
              <li>
                <Link prefetch={false} href="/plan#receipt-check">
                  <strong>Check a request receipt</strong>
                  <span>See progress and replies on a request you sent.</span>
                </Link>
              </li>
              {customerCompaniesEnabled() && (
                <li>
                  <Link prefetch={false} href="/account/companies">
                    <strong>Browse approved companies</strong>
                    <span>Companies cleared to take part in missions.</span>
                  </Link>
                </li>
              )}
            </ul>
          </section>
        </>
      )}
      {view === 'work' && (
        <div id="my-work" tabIndex={-1} className="ux-account-groups">
          {workspaceIssuer && (
            <div id="customer-workspaces" tabIndex={-1}>
              <CustomerWorkspaces
                key={`${workspaceIssuer}:${data.user.id}`}
                subject={data.user.id}
                issuer={workspaceIssuer}
                requestsEnabled={requestCreationEnabled}
                programmesEnabled={customerProgrammesEnabled()}
                profilesEnabled={customerOrganisationProfilesEnabled()}
                draftsEnabled={customerMissionDraftsEnabled()}
                memberRolesEnabled={customerMemberRolesEnabled()}
                linksEnabled={customerOrganisationLinksEnabled()}
              />
            </div>
          )}
          {workspaceIssuer && customerParticipantsEnabled() && (
            <p>
              <Link className="text-link" href="/account/delegations">
                Delegation registrations
              </Link>
            </p>
          )}
          {requestIssuer && (
            <div id="customer-requests" tabIndex={-1}>
              <CustomerRequests
                detailsEnabled={customerRequestDetailsEnabled()}
                subject={data.user.id}
                issuer={requestIssuer}
                statuses={missionStatus.options}
                canSubmit={requestCreationEnabled}
              />
            </div>
          )}
        </div>
      )}
      {view === 'results' && (
        <div id="results" tabIndex={-1} className="ux-account-groups">
          <div id="customer-missions" tabIndex={-1}>
            {savedMissionIssuer && (
              <div id="saved-commercial-missions">
                {customerDeliveryEnabled() && (
                  <AssignedMissions subject={data.user.id} issuer={savedMissionIssuer} />
                )}
                <SavedMissions subject={data.user.id} issuer={savedMissionIssuer} />
                {customerCompaniesEnabled() && (
                  <p>
                    <Link className="text-link" href="/account/companies">
                      Browse approved companies
                    </Link>
                  </p>
                )}
              </div>
            )}
            <CustomerMissions key={data.user.id} />
          </div>
        </div>
      )}
      {view === 'more' && (
        <div id="more" tabIndex={-1} className="ux-account-groups">
          <aside className="ux-account-sidebar" aria-label="Account and access">
            <section className="ux-account-profile" aria-label="Your verified profile">
              <span className="ux-status" data-tone="positive">
                Verified account email
              </span>
              <h2>{data.user.name}</h2>
              <p>{data.user.email}</p>
              <p>Your email address is verified. This does not verify your company.</p>
            </section>
            <OperatorInvitationHint key={data.user.id} />
            <nav className="access-options" aria-label="Account sections">
              <Link className="text-link" href="/plan">
                Plan a mission
              </Link>
              <Link className="text-link" href="/plan#receipt-check">
                Check a request receipt
              </Link>
              <p>
                Keep the receipt we give you after you send a request. You can use it to check
                progress and replies.
              </p>
            </nav>
            <details className="ux-journey-disclosure">
              <summary>Other ways in</summary>
              <nav className="access-options" aria-label="Other account access">
                <Link className="text-link" href="/operator/setup">
                  Accept a team invitation
                </Link>
                <Link className="text-link" href="/workspace">
                  Start page
                </Link>
                <Link className="text-link" href="/contributor">
                  Local helper tasks
                </Link>
              </nav>
            </details>
            <AccountSignout />
          </aside>
        </div>
      )}
    </CustomerShell>
  );
}
