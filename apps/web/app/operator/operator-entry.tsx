import Link from 'next/link';
import { WorkspaceShell } from '../../components/workspace-shell';
import { TeamSecondLevel } from '../../components/ux/team-second-level';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { foundations } from '../../lib/foundations';
import { ownerCapable, ownerPageEnabled } from '../../lib/owner-access';
import { problemReportsOffered } from '../../lib/problem-reports-offered';
import { uxSwitchOn } from '../../lib/ux-switches';
import { operatorSignInPath } from '../../lib/workspace-navigation';
import { OperatorFlags } from './operator-flags';
import { Workspace } from './workspace';
import { teamSectionTitle } from '../../lib/ux/shells';
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
  const shellsV2 = uxSwitchOn('CORRIDRA_UX_SHELLS_V2');
  const ownerPage = ownerPageEnabled() && ownerCapable(tenants).length > 0;
  // With the shells switch and section addresses on, each section has its own heading (CQ-36).
  const heading =
    shellsV2 && uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS') ? teamSectionTitle(section) : null;
  return (
    <WorkspaceShell
      eyebrow={shellsV2 ? 'TEAM WORKSPACE' : 'OPERATOR WORKSPACE'}
      title={heading ?? 'Your workspace.'}
      // When the page heading already says Today, the Today panel keeps its heading for screen readers only.
      className={heading === 'Today' ? 'ux-operator-home ux-titled-today' : 'ux-operator-home'}
    >
      {shellsV2 ? (
        <TeamSecondLevel urls={uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')} ownerPage={ownerPage} />
      ) : null}
      <OperatorFlags replyReview={uxSwitchOn('CORRIDRA_REPLY_PAGE')}>
        <Workspace
          tenants={tenants}
          initialTenant={selected!}
          initialSection={section}
          ownerPage={ownerPage}
          moveRecords={customerMovesEnabled()}
          shellsV2={shellsV2}
          problemReports={await problemReportsOffered()}
        />
      </OperatorFlags>
    </WorkspaceShell>
  );
}
