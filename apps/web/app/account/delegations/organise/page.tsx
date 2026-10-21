import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { CustomerShell } from '../../../../components/customer-shell';
import { WorkspaceChooser } from '../../../../components/workspace-chooser';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Manage programmes | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <CustomerShell tab="work" eyebrow="MY WORK" title="Manage programmes">
      <WorkspaceChooser kind="programmes" enabled={customerProgrammesEnabled()} />
    </CustomerShell>
  );
}
