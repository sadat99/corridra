import { notFound } from 'next/navigation';
import { z } from 'zod';
import { customerDecisionsEnabled } from '@corridra/auth/customer-decisions';
import { specificationConfirmationForPage } from '../../../../lib/specification-availability';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { CustomerShell } from '../../../../components/customer-shell';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { customerPageSession } from '../../../../lib/customer-page-session';
import { initialLensFor } from '../../../../lib/room';
import { loadRoomLink } from '../../../../lib/room-loader';
import { uxSwitchOn } from '../../../../lib/ux-switches';
import { RoomView } from './room-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Your request | Corridra',
  robots: { index: false, follow: false },
};

/**
 * The Room: one request in one place. Behind `CORRIDRA_UX_ROAD`: with the switch off this address does
 * not exist, and the saved request page and the saved mission page are exactly as they were.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ view?: string | string[]; report?: string | string[] }>;
}) {
  if (!uxSwitchOn('CORRIDRA_UX_ROAD')) notFound();
  const parsed = z.uuid().safeParse((await params).requestId);
  if (!parsed.success) notFound();
  if (!customerRequestDetailsEnabled())
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your request" compact>
        <p role="status">Saved request details are unavailable.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const session = await customerPageSession(
    uxSwitchOn('CORRIDRA_STATUS_LINK') ? `/account/rooms/${parsed.data}` : undefined,
  );
  if (!session.ok)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your request" compact>
        <p role="alert">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const query = await searchParams;
  // `report` names one delivered report, from a Home card or after a save. It is a hint only: it is checked as a
  // uuid here and then only chooses among the reports this person's own list returns for this request.
  const hint = z.uuid().safeParse(query.report);
  const load = await loadRoomLink(
    parsed.data,
    session.subject,
    session.issuer,
    hint.success ? hint.data : undefined,
  );
  // Meetings opens the Room on its Trip lens, and a saved report on its comparison. Display choices only: the same
  // reads, the same guards.
  const initialLens = initialLensFor(query.view, {
    trip: uxSwitchOn('CORRIDRA_UX_TRIP'),
    lenses: uxSwitchOn('CORRIDRA_UX_LENSES'),
  });
  return (
    <CustomerShell
      tab="work"
      eyebrow="ROOM"
      title={<span className="sr-only">Your request, in one place.</span>}
    >
      <RoomView
        requestId={parsed.data}
        subject={session.subject}
        issuer={session.issuer}
        link={load.link}
        task={load.status === 'ok' ? load.task : undefined}
        hintClosed={load.status === 'ok' && load.hintClosed}
        unreadable={load.status === 'unreadable'}
        reportCount={load.status === 'ok' ? load.count : 0}
        serviceRequestsEnabled={customerServiceRequestsEnabled()}
        decisionsEnabled={customerDecisionsEnabled()}
        specificationConfirmationsEnabled={await specificationConfirmationForPage()}
        lenses={uxSwitchOn('CORRIDRA_UX_LENSES')}
        trip={uxSwitchOn('CORRIDRA_UX_TRIP')}
        initialLens={initialLens}
      />
    </CustomerShell>
  );
}
