import '../../operator-overview.css';
import './mission-page.css';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { TeamContextPublisher } from '../../../../components/ux/team-context-publisher';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { TeamSecondLevel } from '../../../../components/ux/team-second-level';
import { foundations } from '../../../../lib/foundations';
import { isUuid } from '../../../../lib/reply-review-view';
import { uxSwitchOn } from '../../../../lib/ux-switches';
import { OperatorFlags } from '../../operator-flags';
import { MissionPage } from './mission-page';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Mission | Corridra',
  robots: { index: false, follow: false },
};

/**
 * One mission at /operator/missions/<id> (D15), with tabs and one side panel for actions. It answers the
 * same "not found" as any unknown address unless the section word is exactly "missions" and the
 * CORRIDRA_UX_MISSIONS_V2 switch is on, so with the switch off nothing new is reachable. The records come
 * from the same tenant-checked services as the queue; this page adds no authority.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string; missionId: string }>;
  searchParams: Promise<{ workspace?: string; reply?: string }>;
}) {
  const { section, missionId } = await params;
  if (section !== 'missions' || !uxSwitchOn('CORRIDRA_UX_MISSIONS_V2')) notFound();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId))
    notFound();
  const { workspace: requested, reply } = await searchParams;
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>The protected workspace is not configured in this environment.</p>
        <Link prefetch={false} className="text-link" href="/">
          Back to Corridra
        </Link>
      </WorkspaceShell>
    );
  await s.ready;
  const identity = await s.provider.getSession(await headers());
  if (!identity) {
    const back =
      `/operator/missions/${missionId}` +
      (requested && /^[0-9a-f-]{36}$/i.test(requested) ? `?workspace=${requested}` : '');
    redirect('/operator/signin?next=' + encodeURIComponent(back));
  }
  const tenants = await s.access.tenants(identity.token);
  const chosen = tenants.find((t) => t.id === requested) ?? tenants[0];
  if (!chosen)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>Your session needs a current authenticator check and an active membership.</p>
        <Link prefetch={false} className="text-link" href="/operator">
          Back to your workspace
        </Link>
      </WorkspaceShell>
    );
  const tenant = chosen.id;
  return (
    <WorkspaceShell eyebrow="MISSION" title="Mission" className="ux-operator-home">
      <TeamContextPublisher tenant={tenant} role={chosen.role} />
      {uxSwitchOn('CORRIDRA_UX_SHELLS_V2') ? (
        <TeamSecondLevel urls={uxSwitchOn('CORRIDRA_UX_OPERATOR_URLS')} ownerPage={false} />
      ) : null}
      <OperatorFlags replyReview={uxSwitchOn('CORRIDRA_REPLY_PAGE')}>
        <MissionPage
          tenant={tenant}
          workspaceName={tenants.find((t) => t.id === tenant)?.name ?? ''}
          missionId={missionId}
          replyId={isUuid(reply) ? reply : undefined}
          moveRecords={customerMovesEnabled()}
        />
      </OperatorFlags>
    </WorkspaceShell>
  );
}
