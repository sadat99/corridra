import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { foundations } from '../../lib/foundations';
import type { TeamWorkspace } from '../../lib/ux/team-desk-v41';
import { TeamFrame } from '../../components/ux/team-frame';
import { ownerPageEnabled } from '../../lib/owner-access';
import { problemReportsOffered } from '../../lib/problem-reports-offered';
import { uxSwitchOn } from '../../lib/ux-switches';

/**
 * The Team shell (D14), behind CORRIDRA_UX_SHELLS_V2. With the switch off this layout adds nothing
 * and every team page renders exactly as before. With it on, workspace pages get the left sidebar
 * and the in-place authenticator dialog (D12); sign-in and recovery pages stay plain. Who may see
 * what is still decided by each page and the server; the sidebar is navigation only.
 */
/**
 * Team desk v4.1: the workspaces of the signed-in person, for the menu's workspace switch on the team pages that
 * do not load the workspace themselves (the Inbox, Supply and mission pages). The same read every team page
 * already makes for its own list, and names only: it grants nothing, and each page and the server still decide.
 * Signed out, not configured or failed, the list is empty and the menu shows no switch.
 */
async function teamWorkspaces(): Promise<TeamWorkspace[]> {
  const services = foundations();
  if (!services) return [];
  // Read outside the guard below: the framework uses this call to mark the page as rendered per request.
  const requestHeaders = await headers();
  try {
    await services.ready;
    const identity = await services.provider.getSession(requestHeaders);
    if (!identity) return [];
    const tenants = await services.access.tenants(identity.token);
    return tenants.map((tenant) => ({ id: tenant.id, name: tenant.name }));
  } catch {
    // The menu then shows no switch; the page itself still reads and reports its own access. No personal data.
    console.error(JSON.stringify({ event: 'team_menu_workspaces_read_failed' }));
    return [];
  }
}

export default async function OperatorLayout({ children }: { children: ReactNode }) {
  if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2')) return children;
  const deskV41 = uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41');
  return (
    <TeamFrame
      urls={uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')}
      ownerPage={ownerPageEnabled()}
      desk={uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK')}
      problemReports={await problemReportsOffered()}
      deskV41={deskV41}
      supply={uxSwitchOn('CORRIDRA_SUPPLY_SOURCES')}
      workspaces={deskV41 ? await teamWorkspaces() : []}
    >
      {children}
    </TeamFrame>
  );
}
