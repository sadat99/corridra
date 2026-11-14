import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { CustomerShell } from '../../../../components/customer-shell';
import { WorkspaceChooser } from '../../../../components/workspace-chooser';
import { programmesChooserBack } from '../../frame-copy';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Programmes | Corridra',
  robots: { index: false, follow: false },
};
export default function Page() {
  return (
    <CustomerShell
      tab="work"
      eyebrow="PROGRAMMES"
      title="Programmes"
      frame={{ back: programmesChooserBack }}
    >
      <WorkspaceChooser kind="programmes" enabled={customerProgrammesEnabled()} />
    </CustomerShell>
  );
}
