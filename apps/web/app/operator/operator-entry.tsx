import Link from 'next/link';
import { WorkspaceShell } from '../../components/workspace-shell';
import { TeamSecondLevel } from '../../components/ux/team-second-level';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { foundations } from '../../lib/foundations';
import { ownerCapable, ownerPageEnabled } from '../../lib/owner-access';
import { problemReportsOffered } from '../../lib/problem-reports-offered';
import { programmeApplicationsOffered } from '../../lib/programme-applications-offered';
import { uxSwitchOn } from '../../lib/ux-switches';
import { operatorSignInPath, sectionRefusedForRole } from '../../lib/workspace-navigation';
import { OperatorFlags } from './operator-flags';
import { Workspace } from './workspace';
import { operatorHeader } from '../../components/ux/desk-frame';
/**
 * The protected workspace, shared by `/operator` and (with the address switch on) `/operator/<section>`.
 * `section` is a section id from the closed list; the rendering is otherwise the same.
 */
export async function OperatorEntry({
  requested,
  section,
}: {
  requested?: string;
  section?: string;
}) {
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>The protected workspace is not configured in this environment.</p>
        <Link prefetch={false} className="text-link" href="/signin">
          Other sign-in options
        </Link>
        <Link prefetch={false} className="text-link" href="/">
          Back to Corridra
        </Link>
      </WorkspaceShell>
    );
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity) {
    const destination =
      (requested && /^[0-9a-f-]{36}$/i.test(requested)
        ? '/operator?workspace=' + requested
        : '/operator') + (section ? '#' + section : '');
    redirect('/operator/signin?next=' + encodeURIComponent(destination));
  }
  const tenants = await s.access.tenants(identity.token);
  const selected = tenants.find((t) => t.id === requested)?.id ?? tenants[0]?.id;
  if (tenants.length === 0)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>Your session needs a current authenticator check and an active membership.</p>
        <p>
          Ask your workspace owner to confirm the invitation and your assigned role. A customer
          account uses a separate sign-in and does not grant operator membership.
        </p>
        <Link prefetch={false} className="text-link" href="/workspace">
          Choose your workspace or tool
        </Link>
        <p>
          Invited contributors use their assigned-task link, which does not grant workspace
          membership.
        </p>
        <Link prefetch={false} className="text-link" href="/contributor">
          Assigned-task invitation help
        </Link>
        <Link prefetch={false} className="text-link" href="/signin">
          Other sign-in options
        </Link>
        {/* Full page load: drops cached workspace; Next 16.4.3 doubles a # on soft return. */}
        <a className="text-link" href={operatorSignInPath(requested, section)}>
          Verify your access
        </a>
      </WorkspaceShell>
    );
  // Health and Readiness are for the owner and admin only. The role of the workspace in view decides here, on the server,
  // so an ordinary member who types the address lands on Today, whatever the switches say. Every other section keeps
  // the screen's own "unavailable for your role" note.
  const role = tenants.find((t) => t.id === selected)?.role;
  if (section && sectionRefusedForRole(section, role))
    redirect(selected ? '/operator?workspace=' + selected : '/operator');
  const shellsV2 = uxSwitchOn('CORRIDRA_UX_SHELLS_V2');
  const ownerPage = ownerPageEnabled() && ownerCapable(tenants).length > 0;
  // The header for these switches and this address: as it always was, or the team desk v4.1 page pattern.
  const header = operatorHeader({
    shellsV2,
    urls: uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS'),
    teamDeskV41: uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41'),
    section,
    ownerPage,
  });
  return (
    <WorkspaceShell
      eyebrow={header.eyebrow}
      title={header.title}
      lead={header.lead}
      className={header.className}
    >
      {shellsV2 ? (
        <TeamSecondLevel
          urls={uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')}
          ownerPage={ownerPage}
          desk={uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK')}
        />
      ) : null}
      {header.segments}
      <OperatorFlags
        replyReview={uxSwitchOn('CORRIDRA_REPLY_PAGE')}
        supplySources={uxSwitchOn('CORRIDRA_SUPPLY_SOURCES')}
        teamDeskV41={shellsV2 && uxSwitchOn('CORRIDRA_UX_TEAM_DESK_V41')}
      >
        <Workspace
          tenants={tenants}
          initialTenant={selected!}
          initialSection={section}
          ownerPage={ownerPage}
          moveRecords={customerMovesEnabled()}
          shellsV2={shellsV2}
          desk={shellsV2 && uxSwitchOn('CORRIDRA_UX_OPERATOR_DESK')}
          problemReports={await problemReportsOffered()}
          programmeApplications={await programmeApplicationsOffered()}
        />
      </OperatorFlags>
    </WorkspaceShell>
  );
}
