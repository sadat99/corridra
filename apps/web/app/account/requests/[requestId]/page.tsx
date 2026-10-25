import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { customerRequestDetailsEnabled } from '@corridra/auth/customer-request-details';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { CustomerShell } from '../../../../components/customer-shell';
import { neonAuth } from '../../../../lib/neon-auth';
import { CustomerRequestDetail } from '../request-detail';
import { uxSwitchOn } from '../../../../lib/ux-switches';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Your saved request | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ requestId: string }> }) {
  if (!customerRequestDetailsEnabled())
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your saved request" compact>
        <p role="status">
          {' '}
          {realCustomerInput()
            ? 'Saved request details are unavailable.'
            : 'Saved sample request details are unavailable.'}{' '}
        </p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const parsed = z.uuid().safeParse((await params).requestId);
  if (!parsed.success) notFound();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  const session = await auth?.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!issuer || !session || session.error)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your saved request" compact>
        <p role="alert">Your account could not be checked. Return to your account and try again.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return (
    <CustomerShell tab="work" eyebrow="MY WORK" title="Your saved request">
      {uxSwitchOn('CORRIDRA_UX_ROAD') && (
        <p>
          <a className="text-link" href={`/account/rooms/${parsed.data}`}>
            Open this request in its Room
          </a>
        </p>
      )}
      <CustomerRequestDetail
        requestId={parsed.data}
        subject={session.data.user.id}
        issuer={issuer}
        serviceRequestsEnabled={customerServiceRequestsEnabled()}
      />
    </CustomerShell>
  );
}
