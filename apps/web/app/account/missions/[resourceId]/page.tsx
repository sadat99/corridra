import { customerDecisionsEnabled } from '@corridra/auth/customer-decisions';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { customerSavedMissionsEnabled } from '@corridra/auth/customer-saved-missions';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { CustomerShell } from '../../../../components/customer-shell';
import { neonAuth } from '../../../../lib/neon-auth';
import { SavedCommercialReport } from '../saved-commercial-report';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Your commercial mission | Corridra',
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ resourceId: string }> }) {
  if (!customerSavedMissionsEnabled())
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your commercial mission" compact>
        <p role="status">Saved commercial missions are unavailable.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const id = z.uuid().safeParse((await params).resourceId);
  if (!id.success) notFound();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  const session = await auth?.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!issuer || !session || session.error)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Your commercial mission" compact>
        <p role="alert">Your account could not be checked. Return to your account and try again.</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return (
    <CustomerShell tab="results" eyebrow="APPROVED PRIVATE REPORT" title="Your commercial mission">
      <SavedCommercialReport
        resourceId={id.data}
        subject={session.data.user.id}
        issuer={issuer}
        decisionsEnabled={customerDecisionsEnabled()}
      />
    </CustomerShell>
  );
}
