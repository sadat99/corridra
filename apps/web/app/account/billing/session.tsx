import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { readNeonAuthConfig } from '@corridra/config';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { neonAuth } from '../../../lib/neon-auth';

export function billingNotice(message: string, title = 'Plan and billing'): ReactNode {
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
export async function billingSession(): Promise<
  { subject: string; issuer: string } | { notice: ReactNode }
> {
  if (!customerBillingEnabled()) return { notice: billingNotice('Plans are unavailable.') };
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth) return { notice: billingNotice('Plans are unavailable.') };
  const session = await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!session || session.error)
    return {
      notice: billingNotice(
        'Your account could not be checked. Return to your account and try again.',
      ),
    };
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return { subject: session.data.user.id, issuer };
}
