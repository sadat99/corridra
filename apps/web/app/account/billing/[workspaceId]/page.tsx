import { notFound } from 'next/navigation';
import { z } from 'zod';
import { customerInvoicingEnabled } from '@corridra/auth/customer-invoicing';
import { customerRealInvoicingEnabled } from '@corridra/auth/customer-invoicing-real';
import { customerSimulatedPaymentsEnabled } from '@corridra/auth/customer-payments-simulated';
import { realUseEnabled } from '@corridra/auth/customer-production';
import { CustomerShell } from '../../../../components/customer-shell';
import { BillingOverviewView } from '../billing-overview';
import { InvoicesSection } from '../invoices-section';
import { RealInvoicesSection } from '../real-invoices-section';
import { SimulatedPaymentsSection } from '../simulated-payments-section';
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
        invoicing={customerInvoicingEnabled()}
        sampleOnly={
          !realUseEnabled() && customerInvoicingEnabled() ? (
            <InvoicesSection
              subject={session.subject}
              issuer={session.issuer}
              workspaceId={id.data}
            />
          ) : null
        }
      />
      {realUseEnabled() && customerRealInvoicingEnabled() && (
        <RealInvoicesSection
          subject={session.subject}
          issuer={session.issuer}
          workspaceId={id.data}
        />
      )}
      {realUseEnabled() && customerSimulatedPaymentsEnabled() && (
        <SimulatedPaymentsSection
          subject={session.subject}
          issuer={session.issuer}
          workspaceId={id.data}
        />
      )}
    </CustomerShell>
  );
}
