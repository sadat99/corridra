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
import { isJourney, journeyOfTask, journeyTargets, journeysOf, type Journey } from './journeys';
import { loadJourneyFacts } from '../../../lib/home-journeys/load';

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
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ journey?: string | string[] }>;
}) {
  const asked = (await searchParams).journey;
  // Only a known journey filters; anything else shows everything, never an empty page.
  const journey: Journey | null = isJourney(asked) ? asked : null;
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
  const facts = await loadJourneyFacts(
    session.subject,
    session.issuer,
    journeyTargets(journeys?.cards ?? []),
  ).catch(() => null);
  // Each task's journey, by card id (and by request for an unread reply). Unknown is shown under All only.
  const taskJourneys: Record<string, Journey> = {};
  if (work) {
    for (const card of model.cards) {
      const j = journeyOfTask(work, card);
      if (j) taskJourneys[card.id] = j;
    }
    for (const row of model.waiting) {
      const j = journeyOfTask(work, row);
      if (j) taskJourneys[row.id] = j;
    }
    for (const reply of model.replyCandidates) {
      const j = journeyOfTask(work, {
        kind: 'reply',
        id: reply.requestId,
        requestId: reply.requestId,
      });
      if (j) taskJourneys[`reply:${reply.requestId}`] = j;
    }
  }
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
        facts={facts}
        journey={journey}
        taskJourneys={taskJourneys}
      />
    </CustomerShell>
  );
}
