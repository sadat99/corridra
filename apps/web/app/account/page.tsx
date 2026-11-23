import { AssignedMissions } from './assigned-missions';
import { customerDeliveryEnabled } from '@corridra/auth/customer-assigned-missions';
import { WorkspaceShell } from '../../components/workspace-shell';
import { CustomerShell } from '../../components/customer-shell';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { neonAuth } from '../../lib/neon-auth';
import { AccountSignout } from './signout';
import { ThisDevice } from './this-device';
import { CustomerMissions } from './customer-missions';
import { SavedMissions } from './saved-missions';
import { MemberReports } from './member-reports';
import { memberAccessOn } from '../../lib/member-access';
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
import { customerIssuerFromEnv, realUseEnabled } from '@corridra/auth/customer-production';
import { PendingRequestNotice } from '../../components/pending-request-notice';
import { customerProgrammePagesEnabled } from '@corridra/auth/customer-programme-publication';
import { ProgrammeApplyNotice } from '../../components/programme-apply-notice';
import { Suspense } from 'react';
import { WorkList } from './work-list';
import { HomeNextStep } from './home-next-step';
import { HomeWork } from './home-work';
import { RequestsTabs } from './requests-tabs';
import { ReportsTabs } from './reports-tabs';
import { AccountSettings } from './account-settings';
import { PersonalProfile } from './personal-profile';
import { accountSecurityCapabilities } from '../../lib/account-security-capabilities';
import { profilePictureCapability } from '../../lib/profile-picture-capability';
import { AccountClosure, AccountClosureComingSoon } from './account-closure';
import { ContrastRow, LessMovementRow, TextSizeRow } from '../../components/ux/comfort-controls';
import { customerAccountLifecycleEnabled } from '@corridra/auth/customer-account-lifecycle';
import { customerNotificationsEnabled } from '@corridra/auth/customer-notifications';
import { InvitationProvider, OpenInvitationButton } from './invitation-dialog';
import { parseWorkFilter } from '../../lib/work-items/view';
import { homeHelper, requestsHelper } from './frame-copy';
import { activeJourneyMode } from '../../lib/ux/journey-mode-server';
import { journeyModeOfWork, journeyModeWords } from '../../lib/ux/journey-mode';
import { ShowEverything } from '../../components/ux/journey-note';
import { JourneyScoped } from '../../components/ux/journey-scoped';
import { readRequestsOutsideJourney } from '../../lib/work-items/journey-scope-server';
import './calm-lists.css';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Your account | Corridra',
  robots: { index: false, follow: false },
};
const views = ['home', 'work', 'results', 'more'] as const;
/** The Reports view, named once for the journey scope below. */
const reportsView = views[2];
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
        <PendingRequestNotice where="verify" enabled={realUseEnabled()} />
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
  // ADR-087 U5: the Members' Reports tab only for someone who owns or manages a workspace with at least one other current
  // member. The probe reads no member item and records nothing; any failure means no tab.
  let memberReportsVisible = false;
  if (savedMissionIssuer && memberAccessOn()) {
    const services = foundations();
    if (services)
      try {
        await services.ready;
        memberReportsVisible =
          (
            await services.customerMemberAccess.workspaces(data.user.id, savedMissionIssuer)
          )?.workspaces.some((workspace) => workspace.others > 0) ?? false;
      } catch {
        /* No tab: the person owns or manages nothing reachable, or the module is not installed. */
      }
  }
  const heading = headings[view];
  // Journey modes (null while that switch is off): on Requests the address's own filter wins, then the journey
  // chosen in the sidebar, so a plain click on Requests opens the chosen journey.
  const mode = await activeJourneyMode(view === 'work' ? journeyModeOfWork(query.work) : null);
  const scoped = mode && mode !== 'all' ? mode : null;
  const workFilter = scoped && query.work === undefined ? scoped : parseWorkFilter(query.work);
  // Reports in a journey: the requests the shared work list places in another journey. Their delivered reports are
  // left out; a list with no request id (saved, shared, members') stays whole and says it is not sorted.
  const outside =
    scoped && view === reportsView ? await readRequestsOutsideJourney(scoped) : undefined;
  const journeyName = scoped ? journeyModeWords[scoped] : undefined;
  return (
    <CustomerShell
      tab={view}
      eyebrow={heading.eyebrow}
      title={heading.title}
      journeyMode={mode}
      frame={
        view === 'home'
          ? { helper: homeHelper }
          : view === 'work'
            ? { helper: requestsHelper }
            : undefined
      }
    >
      <AccountHashRedirect view={view} />
      {view === 'home' && (
        <>
          <PendingRequestNotice where="account" enabled={realUseEnabled()} />
          {customerProgrammePagesEnabled() && <ProgrammeApplyNotice />}
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
          <section className="guide-area ux-account-groups home-open" aria-labelledby="open-title">
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
                  <JourneyScoped mode={scoped}>
                    <WorkList
                      subject={data.user.id}
                      issuer={workspaceIssuer}
                      filter={workFilter}
                      rooms={uxSwitchOn('CORRIDRA_UX_ROAD')}
                      framed
                      showAll={scoped ? <ShowEverything /> : undefined}
                    />
                  </JourneyScoped>
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
                      framed
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
                journey={!!scoped}
                delivered={
                  (requestIssuer || (savedMissionIssuer && customerDeliveryEnabled())) && (
                    <JourneyScoped mode={scoped}>
                      {requestIssuer && (
                        <DeliveredReports
                          subject={data.user.id}
                          issuer={requestIssuer}
                          showEmpty={!(savedMissionIssuer && customerDeliveryEnabled())}
                          outside={outside}
                          journey={journeyName}
                        />
                      )}
                      {savedMissionIssuer && customerDeliveryEnabled() && (
                        <AssignedMissions
                          subject={data.user.id}
                          issuer={savedMissionIssuer}
                          outside={outside}
                          journey={journeyName}
                        />
                      )}
                    </JourneyScoped>
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
                            Browse Approved Companies
                          </Link>
                        </p>
                      )}
                    </div>
                  )
                }
                shared={
                  <>
                    <CustomerMissions
                      key={data.user.id}
                      beforeSend={uxSwitchOn('CORRIDRA_UX_BEFORE_SEND')}
                    />
                    {customerCompaniesEnabled() && (
                      <p>
                        <Link
                          prefetch={false}
                          className="text-link ux-action"
                          href="/account/companies"
                        >
                          Browse Approved Companies
                        </Link>
                      </p>
                    )}
                  </>
                }
                members={
                  savedMissionIssuer &&
                  memberReportsVisible && (
                    <MemberReports subject={data.user.id} issuer={savedMissionIssuer} />
                  )
                }
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
                <h2>Profile and Identity</h2>
                <PersonalProfile
                  subject={data.user.id}
                  issuer={customerIssuerFromEnv()}
                  name={typeof data.user.name === 'string' ? data.user.name.trim() || null : null}
                  email={data.user.email}
                  nameEditable={accountSecurityCapabilities.updateName}
                  detailsEnabled={customerWorkspacesEnabled()}
                  pictureEnabled={profilePictureCapability.profilePicture}
                />
              </section>
            }
            security={
              <section aria-label="Sign-in and security" className="ux-account-panel">
                <h2>Sign-in and Security</h2>
                <div className="ux-account-actions">
                  <AccountSignout />
                </div>
                <p>
                  <Link prefetch={false} className="text-link ux-action" href="/forgot-password">
                    Reset Your Password
                  </Link>
                </p>
                <p>We email you a link to choose a new password.</p>
                <OperatorInvitationHint
                  key={data.user.id}
                  headingLevel={3}
                  className="ux-account-card ux-account-row"
                />
                {!uxSwitchOn('CORRIDRA_UX_NAV') && <WaysIn />}
              </section>
            }
            privacy={
              <section aria-label="Privacy and data" className="ux-account-panel">
                <h2>Privacy and Data</h2>
                <p>Read how we use and keep your data.</p>
                <p>
                  <Link prefetch={false} className="text-link ux-action" href="/privacy">
                    Read the Privacy Notice
                  </Link>
                </p>
                <p>
                  Data export is not available yet. To ask for a copy of your data, use the contact
                  on the{' '}
                  <Link prefetch={false} className="text-link" href="/privacy#rights">
                    privacy page
                  </Link>
                  .
                </p>
                {customerAccountLifecycleEnabled() && accountIssuer ? (
                  <AccountClosure subject={data.user.id} issuer={accountIssuer} />
                ) : (
                  <AccountClosureComingSoon />
                )}
              </section>
            }
            preferences={
              <section aria-label="Preferences and notifications" className="ux-account-panel">
                <h2>Preferences and Notifications</h2>
                {customerNotificationsEnabled() && (
                  <>
                    <ul className="ux-link-list">
                      <li>
                        <Link prefetch={false} href="/account/notifications">
                          <strong>Choose what we email you</strong>
                          <span>Turn each kind of email on or off.</span>
                        </Link>
                      </li>
                    </ul>
                    <p>Emails sent one at a time have a link to mute that request.</p>
                  </>
                )}
                <h3>Reading comfort</h3>
                <TextSizeRow label="Text Size" variant="page" />
                <ContrastRow label="Stronger Colours" variant="page" />
                <LessMovementRow label="Less Movement" variant="page" />
                <p>These choices are kept on this device only.</p>
                <ThisDevice />
              </section>
            }
            workspaces={
              <section aria-label="Workspaces and billing" className="ux-account-panel">
                <h2>Workspaces and Billing</h2>
                <ManageYourWork />
                {customerBillingEnabled() && (
                  <ul className="ux-link-list">
                    <li>
                      <Link prefetch={false} href="/account/billing">
                        <strong>Plan and billing</strong>
                        <span>Your current plan and the plans on offer.</span>
                      </Link>
                    </li>
                  </ul>
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

/** The Manage your work list in the Workspaces group: every link keeps its own switch. */
function ManageYourWork() {
  return (
    <section aria-label="Manage your work">
      <h3>Manage your work</h3>
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
