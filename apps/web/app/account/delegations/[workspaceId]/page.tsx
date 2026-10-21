import { customerProgrammeContextEnabled } from '@corridra/auth/customer-programme-context';
import { customerMissionSharesEnabled } from '@corridra/auth/customer-mission-shares';
import { redirect, notFound } from 'next/navigation';
import { z } from 'zod';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammeEconomicsEnabled } from '@corridra/auth/customer-programme-economics';
import { customerProgrammeCoordinationEnabled } from '@corridra/auth/customer-programme-coordination';
import { customerProgrammeTemplatesEnabled } from '@corridra/auth/customer-programme-templates';
import { customerProgrammeTermsEnabled } from '@corridra/auth/customer-programme-terms';
import { customerProgrammePricingEnabled } from '@corridra/auth/customer-programme-pricing';
import { readNeonAuthConfig } from '@corridra/config';
import { WorkspaceShell } from '../../../../components/workspace-shell';
import { CustomerShell } from '../../../../components/customer-shell';
import { neonAuth } from '../../../../lib/neon-auth';
import { CustomerProgrammes } from '../customer-programmes';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata = {
  title: 'Sample delegation planning | Corridra',
  robots: { index: false, follow: false },
};
function unavailable(message = 'Sample delegation planning is unavailable.') {
  return (
    <WorkspaceShell eyebrow="YOUR ACCOUNT" title="Sample delegation planning" compact>
      <p role="status">{message}</p>
      <a className="text-link" href="/account">
        Return to your account
      </a>
    </WorkspaceShell>
  );
}
export default async function Page({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (!customerProgrammesEnabled()) return unavailable();
  const id = z.uuid().safeParse((await params).workspaceId);
  if (!id.success) notFound();
  const issuer = readNeonAuthConfig()?.NEON_AUTH_BASE_URL;
  const auth = neonAuth();
  if (!issuer || !auth) return unavailable();
  const session = await auth.getSession({ query: { disableCookieCache: true } }).catch(() => null);
  if (!session || session.error)
    return unavailable('Your account could not be checked. Return to your account and try again.');
  if (!session.data?.user) redirect('/signin');
  if (session.data.user.emailVerified !== true) redirect('/verify-email');
  return (
    <CustomerShell tab="work" eyebrow="MY WORK" title="Plan delegations">
      <CustomerProgrammes
        contextEnabled={customerProgrammeContextEnabled()}
        missionSharesEnabled={customerMissionSharesEnabled()}
        subject={session.data.user.id}
        issuer={issuer}
        workspaceId={id.data}
        participantsEnabled={customerParticipantsEnabled()}
        economicsEnabled={customerProgrammeEconomicsEnabled()}
        coordinationEnabled={customerProgrammeCoordinationEnabled()}
        templatesEnabled={customerProgrammeTemplatesEnabled()}
        termsEnabled={customerProgrammeTermsEnabled()}
        pricingEnabled={customerProgrammePricingEnabled()}
      />
    </CustomerShell>
  );
}
