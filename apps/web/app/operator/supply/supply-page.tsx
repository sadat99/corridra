import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { TeamContextPublisher } from '../../../components/ux/team-context-publisher';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { operatorSignInPath } from '../../../lib/workspace-navigation';
import { SupplyModeLine } from './supply-ui';
import './supply.css';

/**
 * The frame every supply source page shares: the switch (a route does not exist while CORRIDRA_SUPPLY_SOURCES is off), the
 * operator session check, the chosen workspace and the one answer for a workspace that cannot be read. `signedIn` draws the
 * screen for the workspace and the person's role. The API decides again on every read and write.
 */
export async function SupplyPage({
  requested,
  title,
  signedIn,
}: {
  /** The `workspace` of the address, when the person chose one. */
  requested?: string;
  title: string;
  signedIn: (tenant: string, role: string) => ReactNode;
}) {
  if (!uxSwitchOn('CORRIDRA_SUPPLY_SOURCES')) notFound();
  const eyebrow = uxSwitchOn('CORRIDRA_UX_SHELLS_V2') ? 'TEAM WORKSPACE' : 'OPERATOR WORKSPACE';
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
  return (
    <WorkspaceShell eyebrow={eyebrow} title={title}>
      <TeamContextPublisher tenant={tenant.id} role={tenant.role} />
      <SupplyModeLine real={realUseEnabled()} />
      {signedIn(tenant.id, tenant.role)}
    </WorkspaceShell>
  );
}
