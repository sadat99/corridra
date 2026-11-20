import { WorkspaceShell } from '../../components/workspace-shell';
import type { Metadata } from 'next';
import { DeliveryView } from '../delivery-view';
import { uxSwitchOn } from '../../lib/ux-switches';
export const metadata: Metadata = {
  title: 'Programme outcomes | Corridra',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};
export default function ProgrammePage() {
  return (
    <WorkspaceShell
      eyebrow="Private programme report"
      title="From participation to commercial progress"
    >
      <DeliveryView
        audience="INSTITUTION_REPORT"
        beforeSend={uxSwitchOn('CORRIDRA_UX_BEFORE_SEND')}
      />
    </WorkspaceShell>
  );
}
