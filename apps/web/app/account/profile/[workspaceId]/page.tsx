import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { customerOrganisationLinksEnabled } from '@corridra/auth/customer-organisation-links';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { readNeonAuthConfig } from '@corridra/config';
import { SubTabs } from '../../../../components/ux/sub-tabs';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { CustomerShell } from '../../../../components/customer-shell';
import { neonAuth } from '../../../../lib/neon-auth';
import { OrganisationProfile } from '../organisation-profile';
import { CompanyLink } from '../company-link';
import { profileBack, profileHelper } from '../../frame-copy';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: realCustomerInput() ? 'Company profile | Corridra' : 'Sample company profile | Corridra',
  robots: { index: false, follow: false },
};
function unavailable(
  message = realCustomerInput()
    ? 'Company profile is unavailable.'
    : 'Sample company profile is unavailable.',
) {
  return (
    <WorkspaceShell
      eyebrow="YOUR ACCOUNT"
      title={realCustomerInput() ? 'Company profile' : 'Sample company profile'}
      compact
    >
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
  const linksOn = customerOrganisationLinksEnabled();
  return (
    <CustomerShell
      tab="work"
      eyebrow="REQUESTS"
      title="Company profile"
      // With company links on, the page keeps its two tabs and their own words; the frame is for the plain page.
      frame={linksOn ? undefined : { back: profileBack, helper: profileHelper() }}
    >
      {linksOn ? (
        <SubTabs
          label="Company profile sections"
          tabs={[
            {
              id: 'profile',
              label: realCustomerInput() ? 'Company profile' : 'Sample company profile',
              panel: (
                <OrganisationProfile
                  subject={session.data.user.id}
                  issuer={issuer}
                  workspaceId={id.data}
                  steps
                />
              ),
            },
            {
              id: 'link',
              label: 'Company link',
              panel: (
                <CompanyLink subject={session.data.user.id} issuer={issuer} workspaceId={id.data} />
              ),
            },
          ]}
        />
      ) : (
        <OrganisationProfile
          subject={session.data.user.id}
          issuer={issuer}
          workspaceId={id.data}
          steps
          framed
        />
      )}
    </CustomerShell>
  );
}
