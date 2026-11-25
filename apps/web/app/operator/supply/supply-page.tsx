import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { TeamContextPublisher } from '../../../components/ux/team-context-publisher';
import { deskFrame } from '../../../components/ux/desk-frame';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import type { DeskOwnPageId } from '../../../lib/ux/page-pattern';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { operatorSignInPath } from '../../../lib/workspace-navigation';
import { OperatorFlags } from '../operator-flags';
import { SupplyModeLine } from './supply-ui';
import { SupplySwitcher } from './supply-switcher';
import '../operator-overview.css';
import './supply.css';

/**
 * The frame every supply source page shares: the switch (a route does not exist while CORRIDRA_SUPPLY_SOURCES is off), the
 * operator session check, the chosen workspace and the one answer for a workspace that cannot be read. `signedIn` draws the
 * screen for the workspace and the person's role. The API decides again on every read and write.
 */
export async function SupplyPage({
  requested,
  title,
  place = 'supply',
  signedIn,
}: {
  /** The `workspace` of the address, when the person chose one. */
  requested?: string;
  title: string;
  /** Team desk v4.1: which Supply page this is, for the purpose line under the title. The title stays the page's own. */
  place?: Exclude<DeskOwnPageId, 'inbox'>;
  /** `desk` is true when the page is drawn with the team desk v4.1 header. */
  signedIn: (tenant: string, role: string, desk: boolean) => ReactNode;
}) {
  if (!uxSwitchOn('CORRIDRA_SUPPLY_SOURCES')) notFound();
  // Team desk v4.1: no label above the title. Off, the header is as it was.
  const deskV41 = uxSwitchOn('CORRIDRA_UX_SHELLS_V2') && uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41');
  const eyebrow = deskV41
    ? undefined
    : uxSwitchOn('CORRIDRA_UX_SHELLS_V2')
      ? 'TEAM WORKSPACE'
      : 'OPERATOR WORKSPACE';
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell eyebrow={eyebrow} title="Workspace access is unavailable.">
        <p>The protected workspace is not configured in this environment.</p>
        <Link prefetch={false} className="text-link" href="/operator">
          Return to Today
        </Link>
      </WorkspaceShell>
    );
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity) redirect(operatorSignInPath(requested));
  const tenants = await s.access.tenants(identity.token);
  const tenant = tenants.find((candidate) => candidate.id === requested) ?? tenants[0];
  if (!tenant)
    return (
      <WorkspaceShell eyebrow={eyebrow} title="Workspace access is unavailable.">
        <p>Your session needs a current authenticator check and an active membership.</p>
        <a className="text-link" href={operatorSignInPath(requested)}>
          Verify your access
        </a>
      </WorkspaceShell>
    );
  // Team desk v4.1 (unit D19): the shared header. The title as it was, one purpose line under it, no label above.
  const frame = deskV41
    ? deskFrame({ place, urls: uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS'), ownerPage: false, title })
    : null;
  return (
    <WorkspaceShell
      eyebrow={eyebrow}
      title={frame?.title ?? title}
      lead={frame?.lead}
      className={frame ? 'ux-operator-home ' + frame.className : ''}
    >
      <TeamContextPublisher tenant={tenant.id} role={tenant.role} />
      {/* Team desk v4.1: the workspace picker of the menu, and the same preview line as the other team pages. */}
      {deskV41 ? (
        <SupplySwitcher
          workspaces={tenants.map((entry) => ({ id: entry.id, name: entry.name }))}
          current={tenant.id}
        />
      ) : null}
      {deskV41 && !realUseEnabled() ? (
        <p className="ux-testmode supply-preview" role="note">
          Preview workspace: use made-up records here, never real customer details.
        </p>
      ) : (
        <SupplyModeLine real={realUseEnabled()} />
      )}
      {/* The client screens read the switch from here (a country shows its mark and name with it on). */}
      <OperatorFlags replyReview={false} supplySources teamDeskV41={deskV41}>
        {signedIn(tenant.id, tenant.role, deskV41)}
      </OperatorFlags>
    </WorkspaceShell>
  );
}
