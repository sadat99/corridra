import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { readNeonAuthConfig } from '@corridra/config';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { neonAuth } from '../../../lib/neon-auth';

export function serviceRequestNotice(message: string, title = 'Paid-service requests'): ReactNode {
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title={title} compact>
      <p role="status">{message}</p>
      <a className="text-link" href="/account">
        Return to your account
      </a>
    </WorkspaceShell>
  );
}
// Server only. Identity is read fresh from the provider session; the browser supplies nothing here.
export async function serviceRequestSession(): Promise<
  { subject: string; issuer: string } | { notice: ReactNode }
> {
  if (!customerServiceRequestsEnabled())
    return { notice: serviceRequestNotice('Paid-service requests are unavailable.') };
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth)
    return { notice: serviceRequestNotice('Paid-service requests are unavailable.') };
  const session = await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!session || session.error)
    return {
      notice: serviceRequestNotice(
        'Your account could not be checked. Return to your account and try again.',
      ),
    };
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return { subject: session.data.user.id, issuer };
}
