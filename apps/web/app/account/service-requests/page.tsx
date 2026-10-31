import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceChooser } from '../../../components/workspace-chooser';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Service requests | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <CustomerShell tab="work" eyebrow="REQUESTS" title="Service requests">
      <WorkspaceChooser kind="services" enabled={customerServiceRequestsEnabled()} />
    </CustomerShell>
  );
}
