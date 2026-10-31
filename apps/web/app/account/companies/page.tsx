import Link from 'next/link';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { redirect } from 'next/navigation';
import { readNeonAuthConfig } from '@corridra/config';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { CustomerShell } from '../../../components/customer-shell';
import { neonAuth } from '../../../lib/neon-auth';
import { CompanyPortfolio } from './company-portfolio';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Your approved companies | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page() {
  if (!customerCompaniesEnabled())
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your approved companies" compact>
        <p role="status">Approved companies are unavailable.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  const session = await auth?.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!issuer || !session || session.error)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your approved companies" compact>
        <p role="alert">Your account could not be checked. Return to your account and try again.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  if (!session.data?.user) redirect(`/signin?next=${encodeURIComponent('/account/companies')}`);
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return (
    <CustomerShell
      tab="companies"
      eyebrow="YOUR COMMERCIAL WORKSPACE"
      title="Your approved companies"
    >
      {customerOrganisationProfilesEnabled() && (
        <p>
          <Link className="text-link" prefetch={false} href="/account/profile">
            Manage your company profiles and links
          </Link>
        </p>
      )}
      <CompanyPortfolio
        subject={session.data.user.id}
        issuer={issuer}
        serviceRequestsEnabled={customerServiceRequestsEnabled()}
      />
    </CustomerShell>
  );
}
