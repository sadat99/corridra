import type { ReactNode } from 'react';
import { TeamFrame } from '../../components/ux/team-frame';
import { ownerPageEnabled } from '../../lib/owner-access';
import { uxSwitchOn } from '../../lib/ux-switches';

/**
 * The Team shell (D14), behind CORRIDRA_UX_SHELLS_V2. With the switch off this layout adds nothing
 * and every team page renders exactly as before. With it on, workspace pages get the left sidebar
 * and the in-place authenticator dialog (D12); sign-in and recovery pages stay plain. Who may see
 * what is still decided by each page and the server; the sidebar is navigation only.
 */
export default function OperatorLayout({ children }: { children: ReactNode }) {
  if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2')) return children;
  return (
    <TeamFrame urls={uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')} ownerPage={ownerPageEnabled()}>
      {children}
    </TeamFrame>
  );
}
