import { notFound } from 'next/navigation';
import { z } from 'zod';
import { customerDecisionsEnabled } from '@corridra/auth/customer-decisions';
import { customerSpecificationConfirmationEnabled } from '@corridra/auth/customer-specification-confirmation';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { CustomerShell } from '../../../../components/customer-shell';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { customerPageSession } from '../../../../lib/customer-page-session';
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
export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
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
  const session = await customerPageSession();
  if (!session.ok)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your request" compact>
        <p role="alert">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const link = await loadRoomLink(parsed.data, session.subject, session.issuer);
  return (
    <CustomerShell tab="work" eyebrow="ROOM" title="Your request, in one place.">
      <RoomView
        requestId={parsed.data}
        subject={session.subject}
        issuer={session.issuer}
        link={link}
        serviceRequestsEnabled={customerServiceRequestsEnabled()}
        decisionsEnabled={customerDecisionsEnabled()}
        specificationConfirmationsEnabled={customerSpecificationConfirmationEnabled()}
        lenses={uxSwitchOn('CORRIDRA_UX_LENSES')}
      />
    </CustomerShell>
  );
}
