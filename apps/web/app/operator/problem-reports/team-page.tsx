import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { TeamContextPublisher } from '../../../components/ux/team-context-publisher';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { ProblemReportsUnavailable } from '../../../components/problem-reports/unavailable';
import { foundations } from '../../../lib/foundations';
import { problemReportsOffered } from '../../../lib/problem-reports-offered';
import { workspaceQuery } from '../../../lib/ux/shells';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { operatorSignInPath } from '../../../lib/workspace-navigation';

/**
 * The frame every team problem report page shares: the operator session check the other team pages make, the chosen
 * workspace (the person's own memberships decide which; any role may file and read their own reports), and the one answer
 * for a service that is not offered yet. `signedIn` draws the screen for the workspace. The routes decide again.
 */
export async function TeamProblemReportsPage({
  requested,
  title,
  filing = false,
  signedIn,
}: {
  /** The `workspace` of the address, when the person chose one. */
  requested?: string;
  title: string;
  filing?: boolean;
  signedIn: (workspace: string) => ReactNode;
}) {
  const eyebrow = uxSwitchOn('CORRIDRA_UX_SHELLS_V2') ? 'TEAM WORKSPACE' : 'OPERATOR WORKSPACE';
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
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
  const offered = await problemReportsOffered();
  return (
    <WorkspaceShell eyebrow={eyebrow} title={title}>
      <TeamContextPublisher tenant={tenant.id} role={tenant.role} />
      {offered ? (
        signedIn(tenant.id)
      ) : (
        <>
          <ProblemReportsUnavailable filing={filing} />
          <Link
            prefetch={false}
            className="text-link"
            href={`/operator${workspaceQuery(tenant.id)}`}
          >
            Return to Today
          </Link>
        </>
      )}
    </WorkspaceShell>
  );
}
