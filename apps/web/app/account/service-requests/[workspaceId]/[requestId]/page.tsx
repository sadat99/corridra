import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CustomerShell } from '../../../../../components/customer-shell';
import { ServiceRequestDetailView } from '../../service-request-detail';
import { serviceRequestSession } from '../../session';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Paid-service requests | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ workspaceId: string; requestId: string }>;
}) {
  const ids = z.object({ workspaceId: z.uuid(), requestId: z.uuid() }).safeParse(await params);
  if (!ids.success) notFound();
  const session = await serviceRequestSession();
  if ('notice' in session) return session.notice;
  return (
    <CustomerShell tab="work" eyebrow="YOUR WORKSPACE" title="Help request">
      <ServiceRequestDetailView
        subject={session.subject}
        issuer={session.issuer}
        workspaceId={ids.data.workspaceId}
        requestId={ids.data.requestId}
      />
    </CustomerShell>
  );
}
