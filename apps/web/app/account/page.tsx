import { AssignedMissions } from './assigned-missions';
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { WorkspaceShell } from '../../components/workspace-shell';
import { CustomerShell } from '../../components/customer-shell';
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
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { readNeonAuthConfig } from '@corridra/config';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { missionStatus } from '@corridra/domain/missions';
import { CustomerRequests } from './customer-requests';
import { foundations } from '../../lib/foundations';
import { companyProfilesTitle } from '../../lib/workspace-choice';
import { AccountHashRedirect } from './hash-redirect';
import { DeliveredReports } from './delivered-reports';
import { uxSwitchOn } from '../../lib/ux-switches';
import { PendingRequestNotice } from '../../components/pending-request-notice';
import { ProgrammeApplyNotice } from '../../components/programme-apply-notice';
import { Suspense } from 'react';
import { WorkList } from './work-list';
import { HomeNextStep } from './home-next-step';
import { HomeWork } from './home-work';
import { RequestsTabs } from './requests-tabs';
import { ReportsTabs } from './reports-tabs';
import { AccountSettings } from './account-settings';
import { AccountClosure, AccountClosureComingSoon } from './account-closure';
import { customerAccountLifecycleEnabled } from '@corridra/auth/customer-account-lifecycle';
import { customerNotificationsEnabled } from '@corridra/auth/customer-notifications';
import { InvitationProvider, OpenInvitationButton } from './invitation-dialog';
import { parseWorkFilter } from '../../lib/work-items/view';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your account | Corridra',
  robots: { index: false, follow: false },
};
const views = ['home', 'work', 'results', 'more'] as const;
type View = (typeof views)[number];
const headings: Record<View, { eyebrow: string; title: string }> = {
  home: { eyebrow: 'HOME', title: 'What would you like to do?' },
  work: { eyebrow: 'REQUESTS', title: 'Your requests and workspaces.' },
  results: { eyebrow: 'REPORTS', title: 'Reports and missions shared with you.' },
  more: { eyebrow: 'ACCOUNT', title: 'Your account and settings.' },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; work?: string | string[] }>;
}) {
  const query = await searchParams;
  const requested = query.view;
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
        <Link prefetch={false} className="text-link" href="/signin">
          Return to sign-in
        </Link>
      </WorkspaceShell>
    );
  if (!data?.user) redirect('/signin');
  if (!data.user.emailVerified)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Verify your email." compact>
        <p>Verify the email address on your account to continue.</p>
        <PendingRequestNotice where="verify" />
        <Link prefetch={false} className="primary-link" href="/verify-email">
          Verify Email
        </Link>
        <AccountSignout />
      </WorkspaceShell>
    );
  // UX update: the bare address is the front door, Your Move, once both switches are on. Any `?view=` address
  // and the older hashes keep working, so no saved link breaks.
  if (requested === undefined && uxSwitchOn('CORRIDRA_UX_NAV') && uxSwitchOn('CORRIDRA_UX_MOVE'))
    redirect('/account/move');
  const workspaceIssuer = customerWorkspacesEnabled()
    ? readNeonAuthConfig()?.NEON_AUTH_BASE_URL
    : undefined;
  const accountIssuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
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
          <PendingRequestNotice where="account" />
          <ProgrammeApplyNotice />
          <HomeNextStep
            title="New request"
            text={
              requestCreationEnabled
                ? 'Choose a workspace, then say what you want to achieve.'
                : 'Tell us your goal. It takes a few minutes.'
            }
            href={requestCreationEnabled ? '/account?view=work#customer-workspaces' : '/plan'}
          />
          {workspaceIssuer && (
            <Suspense fallback={<p role="status">Loading your work…</p>}>
              <HomeWork
                subject={data.user.id}
                issuer={workspaceIssuer}
                rooms={uxSwitchOn('CORRIDRA_UX_ROAD')}
              />
            </Suspense>
          )}
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
                <Link prefetch={false} href="/account?view=results&tab=shared">
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
                    <span>Companies we have cleared to work with.</span>
                  </Link>
                </li>
              )}
            </ul>
          </section>
        </>
      )}
      {view === 'work' && (
        <div id="my-work" tabIndex={-1} className="ux-account-groups">
          <RequestsTabs
            requests={
              workspaceIssuer && (
                <Suspense fallback={<p role="status">Loading your work…</p>}>
                  <WorkList
                    subject={data.user.id}
                    issuer={workspaceIssuer}
                    filter={parseWorkFilter(query.work)}
                    rooms={uxSwitchOn('CORRIDRA_UX_ROAD')}
                  />
                </Suspense>
              )
            }
            workspaces={
              <>
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
                      serviceRequestsEnabled={customerServiceRequestsEnabled()}
                      billingEnabled={customerBillingEnabled()}
                    />
                  </div>
                )}
                {workspaceIssuer && customerParticipantsEnabled() && (
                  <p>
                    <Link
                      prefetch={false}
                      className="text-link ux-action"
                      href="/account/delegations"
                    >
                      Delegation registrations
                    </Link>
                  </p>
                )}
              </>
            }
            saved={
              requestIssuer && (
                <div id="customer-requests" tabIndex={-1}>
                  <CustomerRequests
                    detailsEnabled={customerRequestDetailsEnabled()}
                    subject={data.user.id}
                    issuer={requestIssuer}
                    statuses={missionStatus.options}
                    canSubmit={requestCreationEnabled}
                  />
                </div>
              )
            }
          />
        </div>
      )}
      {view === 'results' && (
        <div id="results" tabIndex={-1} className="ux-account-groups">
          <div id="customer-missions" tabIndex={-1}>
            <InvitationProvider>
              <OpenInvitationButton />
              <ReportsTabs
                delivered={
                  (requestIssuer || (savedMissionIssuer && customerDeliveryEnabled())) && (
                    <>
                      {requestIssuer && (
                        <DeliveredReports
                          subject={data.user.id}
                          issuer={requestIssuer}
                          showEmpty={!(savedMissionIssuer && customerDeliveryEnabled())}
                        />
                      )}
                      {savedMissionIssuer && customerDeliveryEnabled() && (
                        <AssignedMissions subject={data.user.id} issuer={savedMissionIssuer} />
                      )}
                    </>
                  )
                }
                saved={
                  savedMissionIssuer && (
                    <div id="saved-commercial-missions">
                      <SavedMissions subject={data.user.id} issuer={savedMissionIssuer} />
                      {customerCompaniesEnabled() && (
                        <p>
                          <Link
                            prefetch={false}
                            className="text-link ux-action"
                            href="/account/companies"
                          >
                            Browse approved companies
                          </Link>
                        </p>
                      )}
                    </div>
                  )
                }
                shared={<CustomerMissions key={data.user.id} />}
              />
            </InvitationProvider>
          </div>
        </div>
      )}
      {view === 'more' && (
        <div id="more" tabIndex={-1} className="ux-account-groups ux-account-settings">
          <AccountSettings
            profile={
              <section
                className="ux-account-profile ux-account-card"
                aria-label="Your verified profile"
              >
                <span className="ux-status" data-tone="positive">
                  Verified account email
                </span>
                <h2>{data.user.name}</h2>
                <p>{data.user.email}</p>
                <p>Your email address is verified. This does not verify your company.</p>
              </section>
            }
            workspaces={
              <section aria-label="Manage your work" className="ux-account-panel">
                <h2>Manage your work</h2>
                <ul className="ux-link-list">
                  <li>
                    <Link prefetch={false} href="/account?view=work&tab=workspaces">
                      <strong>Workspaces and team</strong>
                      <span>Your workspaces, who is on each team and your role.</span>
                    </Link>
                  </li>
                  {customerOrganisationProfilesEnabled() && (
                    <li>
                      <Link prefetch={false} href="/account/profile">
                        <strong>{companyProfilesTitle(customerOrganisationLinksEnabled())}</strong>
                        <span>Your company details and supporting statements.</span>
                      </Link>
                    </li>
                  )}
                  {customerProgrammesEnabled() && (
                    <li>
                      <Link prefetch={false} href="/account/delegations/organise">
                        <strong>Programmes</strong>
                        <span>Programme terms, places, pricing and coordination.</span>
                      </Link>
                    </li>
                  )}
                  {customerServiceRequestsEnabled() && (
                    <li>
                      <Link prefetch={false} href="/account/service-requests">
                        <strong>Service requests</strong>
                        <span>Help requests, questions and quotes.</span>
                      </Link>
                    </li>
                  )}
                </ul>
              </section>
            }
            notifications={
              customerNotificationsEnabled() && (
                <section aria-label="Notifications" className="ux-account-panel">
                  <h2>Notifications</h2>
                  <ul className="ux-link-list">
                    <li>
                      <Link prefetch={false} href="/account/notifications">
                        <strong>Choose what we email you</strong>
                        <span>Turn each kind of email on or off.</span>
                      </Link>
                    </li>
                  </ul>
                </section>
              )
            }
            billing={
              customerBillingEnabled() && (
                <section aria-label="Plan and billing" className="ux-account-panel">
                  <h2>Plan and billing</h2>
                  <ul className="ux-link-list">
                    <li>
                      <Link prefetch={false} href="/account/billing">
                        <strong>Plan and billing</strong>
                        <span>Your current plan and the plans on offer.</span>
                      </Link>
                    </li>
                  </ul>
                </section>
              )
            }
            security={
              <section aria-label="Security" className="ux-account-panel">
                <h2>Security</h2>
                <div className="ux-account-actions">
                  <AccountSignout />
                </div>
                <OperatorInvitationHint
                  key={data.user.id}
                  headingLevel={3}
                  className="ux-account-card ux-account-row"
                />
                {!uxSwitchOn('CORRIDRA_UX_NAV') && <WaysIn />}
                {customerAccountLifecycleEnabled() && accountIssuer ? (
                  <AccountClosure subject={data.user.id} issuer={accountIssuer} />
                ) : (
                  <AccountClosureComingSoon />
                )}
              </section>
            }
          />
          {/* All Tools is in the left bar from 1024 px when it carries the link; this row is the way in below that. */}
          {uxSwitchOn('CORRIDRA_UX_NAV') ? (
            <div className="ux-account-actions ux-account-alltools">
              <Link prefetch={false} className="text-link ux-action" href="/account/all-tools">
                All Tools
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </CustomerShell>
  );
}

/** The entry points All tools holds, kept on Account while the new navigation (and All tools) is off. */
function WaysIn() {
  return (
    <section aria-label="Other ways in" className="ux-ways-in ux-account-group">
      <h3>Other ways in</h3>
      <ul className="ux-link-list">
        <li>
          <Link prefetch={false} href="/plan">
            <strong>Plan a mission</strong>
            <span>Tell us your goal. It takes a few minutes.</span>
          </Link>
        </li>
        <li>
          <Link prefetch={false} href="/plan#receipt-check">
            <strong>Check a request receipt</strong>
            <span>Use the receipt we gave you to check progress and replies.</span>
          </Link>
        </li>
        <li>
          <Link prefetch={false} href="/operator/setup">
            <strong>Accept a team invitation</strong>
            <span>For invited Corridra team members.</span>
          </Link>
        </li>
        <li>
          <Link prefetch={false} href="/workspace">
            <strong>Start page</strong>
            <span>All the ways to use Corridra.</span>
          </Link>
        </li>
        <li>
          <Link prefetch={false} href="/contributor">
            <strong>Local helper tasks</strong>
            <span>For local helpers with assigned tasks.</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
