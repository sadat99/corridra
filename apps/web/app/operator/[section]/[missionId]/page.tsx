import '../../operator-overview.css';
import './mission-page.css';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { customerMovesEnabled } from '@corridra/auth/customer-moves';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { foundations } from '../../../../lib/foundations';
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
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { section, missionId } = await params;
  if (section !== 'missions' || !uxSwitchOn('CORRIDRA_UX_MISSIONS_V2')) notFound();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(missionId))
    notFound();
  const requested = (await searchParams).workspace;
  const s = foundations();
  if (!s)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>The protected workspace is not configured in this environment.</p>
        <Link className="text-link" href="/">
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
  const tenant = tenants.find((t) => t.id === requested)?.id ?? tenants[0]?.id;
  if (!tenant)
    return (
      <WorkspaceShell eyebrow="OPERATOR WORKSPACE" title="Workspace access is unavailable.">
        <p>Your session needs a current authenticator check and an active membership.</p>
        <Link className="text-link" href="/operator">
          Back to your workspace
        </Link>
      </WorkspaceShell>
    );
  return (
    <WorkspaceShell eyebrow="MISSION" title="Mission" className="ux-operator-home">
      <OperatorFlags replyReview={uxSwitchOn('CORRIDRA_REPLY_PAGE')}>
        <MissionPage
          tenant={tenant}
          workspaceName={tenants.find((t) => t.id === tenant)?.name ?? ''}
          missionId={missionId}
          moveRecords={customerMovesEnabled()}
        />
      </OperatorFlags>
    </WorkspaceShell>
  );
}
