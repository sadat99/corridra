import '../operator-overview.css';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AccessState } from '../../../components/access-state';
import { deskFrame } from '../../../components/ux/desk-frame';
import { TeamContextPublisher } from '../../../components/ux/team-context-publisher';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { foundations } from '../../../lib/foundations';
import { problemReportsOffered } from '../../../lib/problem-reports-offered';
import { programmeApplicationsOffered } from '../../../lib/programme-applications-offered';
import { privatePageMetadata } from '../../../lib/ux/page-metadata';
import { canOpenInbox } from '../../../lib/ux/team-inbox';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { operatorSignInPath } from '../../../lib/workspace-navigation';
import { OperatorFlags } from '../operator-flags';
import { InboxLists } from './inbox-lists';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = privatePageMetadata('Inbox');

/**
 * The Inbox (team desk v4.1, decision 5 and unit D18): one page for problem reports, erasure requests, programme
 * applications and helper interest. The page does not exist while CORRIDRA_UX_TEAM_DESK_V41 (or the team shell) is
 * off; the lists then stay where they were. It shows the lists the desk already has and changes none of them: who
 * may read or act is decided by each list's own route, with a fresh authenticator check. No count is shown here
 * or in the menu before a list has been read.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  if (!uxSwitchOn('CORRIDRA_UX_SHELLS_V2') || !uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')) notFound();
  const requested = (await searchParams).workspace;
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell title="Workspace access is unavailable.">
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
      <WorkspaceShell title="Workspace access is unavailable.">
        <p>Your session needs a current authenticator check and an active membership.</p>
        <a className="text-link" href={operatorSignInPath(requested)}>
          Verify your access
        </a>
      </WorkspaceShell>
    );
  const frame = deskFrame({
    place: 'inbox',
    urls: uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS'),
    ownerPage: false,
  });
  return (
    <WorkspaceShell
      title={frame.title}
      lead={frame.lead}
      className={'ux-operator-home ' + frame.className}
    >
      <TeamContextPublisher tenant={tenant.id} role={tenant.role} />
      {canOpenInbox(tenant.role) ? (
        <OperatorFlags replyReview={false} teamDeskV41>
          <InboxLists
            tenant={tenant.id}
            role={tenant.role}
            problemReports={await problemReportsOffered()}
            programmeApplications={await programmeApplicationsOffered()}
          />
        </OperatorFlags>
      ) : (
        <AccessState kind="denied">
          <p>Only owners and admins can open the Inbox.</p>
        </AccessState>
      )}
    </WorkspaceShell>
  );
}
