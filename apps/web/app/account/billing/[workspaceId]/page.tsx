import { notFound } from 'next/navigation';
import { z } from 'zod';
import { CustomerShell } from '../../../../components/customer-shell';
import { BillingOverviewView } from '../billing-overview';
import { billingSession } from '../session';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Plan and billing | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  const id = z.uuid().safeParse((await params).workspaceId);
  if (!id.success) notFound();
  const session = await billingSession();
  if ('notice' in session) return session.notice;
  return (
    <CustomerShell tab="more" eyebrow="YOUR WORKSPACE" title="Plan and billing">
      <BillingOverviewView
        subject={session.subject}
        issuer={session.issuer}
        workspaceId={id.data}
      />
    </CustomerShell>
  );
}
