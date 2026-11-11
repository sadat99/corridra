import { customerOrganisationLinksEnabled } from '@corridra/auth/customer-organisation-links';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceChooser } from '../../../components/workspace-chooser';
import { companyProfilesTitle } from '../../../lib/workspace-choice';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// The title names company links only while that switch is on, so it is read per request.
export function generateMetadata() {
  return {
    title: `${companyProfilesTitle(customerOrganisationLinksEnabled())} | Corridra`,
    robots: { index: false, follow: false },
  };
}
export default function Page() {
  const linksEnabled = customerOrganisationLinksEnabled();
  return (
    <CustomerShell
      tab="companies"
      eyebrow="YOUR COMPANY"
      title={companyProfilesTitle(linksEnabled)}
    >
      <WorkspaceChooser
        kind="profile"
        enabled={customerOrganisationProfilesEnabled()}
        linksEnabled={linksEnabled}
      />
    </CustomerShell>
  );
}
