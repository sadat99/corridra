import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CustomerShell } from '../../../../components/customer-shell';
import { ServiceRequestList } from '../service-request-list';
import { serviceRequestSession } from '../session';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Paid-service requests | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const id = z.uuid().safeParse((await params).workspaceId);
  if (!id.success) notFound();
  const session = await serviceRequestSession();
  if ('notice' in session) return session.notice;
  return (
    <CustomerShell tab="work" eyebrow="YOUR WORKSPACE" title="Your help requests">
      <ServiceRequestList subject={session.subject} issuer={session.issuer} workspaceId={id.data} />
    </CustomerShell>
  );
}
