import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceChooser } from '../../../components/workspace-chooser';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Company profiles and links | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <CustomerShell tab="companies" eyebrow="YOUR COMPANY" title="Company profiles and links">
      <WorkspaceChooser kind="profile" enabled={customerOrganisationProfilesEnabled()} />
    </CustomerShell>
  );
}
