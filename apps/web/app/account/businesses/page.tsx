import '../../../components/ux/row-list.css';
import '../calm-lists.css';
import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { customerMissionDraftsEnabled } from '@corridra/auth/customer-mission-drafts';
import { customerMemberRolesEnabled } from '@corridra/auth/customer-member-roles';
import { customerOrganisationLinksEnabled } from '@corridra/auth/customer-organisation-links';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { customerRequestsEnabled } from '@corridra/auth/customer-requests';
import { readNeonAuthConfig } from '@corridra/config';
import { CustomerShell } from '../../../components/customer-shell';
import { neonAuth } from '../../../lib/neon-auth';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { CustomerWorkspaces } from '../customer-workspaces';
import { BusinessRequests } from './business-requests';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'My Businesses | Corridra',
  robots: { index: false, follow: false },
};

/**
 * My Businesses (customer account v18): every business the person owns or belongs to, with its team, profile,
 * plan and invoices, drawn by the same workspace list the account has always used. Owners, admins and members
 * keep exactly the rights the server gives them. While customer requests are on, each business the server lists for
 * this person has a Start a Request link, and the request page checks the membership again. Invitations by email and
 * a request list the whole team shares need server work, so they are tagged Coming soon here.
 */
export default async function Page() {
  // Customer account v18 (live by default); set to "false", this page does not exist, as before.
  if (!uxSwitchOn('CORRIDRA_UX_ACCOUNT_V18')) notFound();
  const auth = neonAuth();
  if (!auth) redirect('/signin');
  const { data } = await auth.getSession({ query: { disableCookieCache: true } });
  if (!data?.user) redirect('/signin');
  const issuer = customerWorkspacesEnabled() ? readNeonAuthConfig()?.NEON_AUTH_BASE_URL : undefined;
  return (
    <CustomerShell tab="more" eyebrow="MORE" title="My Businesses">
      {issuer ? (
        <Suspense fallback={<p role="status">Loading your businesses…</p>}>
          <div id="customer-workspaces" tabIndex={-1}>
            <CustomerWorkspaces
              key={`${issuer}:${data.user.id}`}
              subject={data.user.id}
              issuer={issuer}
              requestsEnabled={customerRequestsEnabled()}
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
        </Suspense>
      ) : (
        <p role="status">Your businesses are unavailable right now.</p>
      )}
      {issuer && (
        <Suspense fallback={<p role="status">Loading requests for your businesses…</p>}>
          <BusinessRequests subject={data.user.id} issuer={issuer} />
        </Suspense>
      )}
      <section className="ux-rows guide-area" aria-label="Coming soon">
        <ul>
          <li className="ux-row">
            <div className="ux-row-link" aria-disabled="true">
              <span className="ux-row-title">Invite by email</span>
              <span className="ux-row-cell">
                Until then, the owner issues an invitation code from Manage Team.
              </span>
              <span className="ux-badge">Coming soon</span>
            </div>
          </li>
          <li className="ux-row">
            <div className="ux-row-link" aria-disabled="true">
              <span className="ux-row-title">Requests owned by the business</span>
              <span className="ux-row-cell">
                A request list the whole team shares. Each request is still visible to the person
                who sent it.
              </span>
              <span className="ux-badge">Coming soon</span>
            </div>
          </li>
        </ul>
      </section>
    </CustomerShell>
  );
}
