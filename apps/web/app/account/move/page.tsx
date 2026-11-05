import { notFound } from 'next/navigation';
import { customerNotificationsEnabled } from '@corridra/auth/customer-notifications';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { CustomerShell } from '../../../components/customer-shell';
import { customerPageSession } from '../../../lib/customer-page-session';
import { buildMoveModel } from '../../../lib/move-cards';
import { loadMoveInput } from '../../../lib/move-loader';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { PendingRequestNotice } from '../../../components/pending-request-notice';
import { EmailNudge } from '../../../components/email-nudge';
import { AccountHashRedirect } from '../hash-redirect';
import { MoveView } from './move-view';
import { Greeting } from './greeting';
import { loadWorkItems } from '../../../lib/work-items/load';
import { journeysOf } from './journeys';

export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';
export const metadata = {
  title: 'Your Move | Corridra',
  robots: { index: false, follow: false },
};

/**
 * Your Move: the front door for a signed-in customer. One list of what is waiting for the person,
 * and what somebody else holds. It reads the records the customer screens already read, adds none and
 * invents none. Behind `CORRIDRA_UX_MOVE`: with the switch off this address does not exist.
 */
export default async function Page() {
  if (!uxSwitchOn('CORRIDRA_UX_MOVE')) notFound();
  const session = await customerPageSession();
  if (!session.ok)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your Move is unavailable." compact>
        <p role="status">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );

  const rooms = uxSwitchOn('CORRIDRA_UX_ROAD');
  // Your Move and the work list read the same records; the work list adds each request's title and journey.
  const [loaded, work] = await Promise.all([
    loadMoveInput(session.subject, session.issuer),
    loadWorkItems(session.subject, session.issuer, { rooms }).catch(() => null),
  ]);
  const model = buildMoveModel(loaded.input, { rooms });
  const journeys = work ? journeysOf(work, model.latest?.id ?? null) : null;
  const startHref = loaded.requestCreationEnabled
    ? '/account?view=work#customer-workspaces'
    : '/plan';
  return (
    <CustomerShell
      tab="move"
      eyebrow="YOUR MOVE"
      title={<Greeting name={session.name} />}
      count={model.cards.length}
    >
      <AccountHashRedirect view="move" />
      <PendingRequestNotice where="account" />
      {customerNotificationsEnabled() && <EmailNudge />}
      <MoveView
        model={model}
        startHref={startHref}
        skippedWorkspaces={loaded.skippedWorkspaces}
        partial={loaded.partial}
        unreadable={loaded.unreadable.length > 0}
        latestItem={journeys?.latest ?? null}
        journeys={journeys?.cards ?? []}
      />
    </CustomerShell>
  );
}
