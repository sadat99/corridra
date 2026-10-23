import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceChooser } from '../../../components/workspace-chooser';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Plan and billing | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <CustomerShell tab="more" eyebrow="MORE" title="Plan and billing">
      <WorkspaceChooser kind="billing" enabled={customerBillingEnabled()} />
    </CustomerShell>
  );
}
