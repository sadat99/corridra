import { notFound } from 'next/navigation';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { customerNotificationsEnabled } from '@corridra/auth/customer-notifications';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { toolsFor } from '../../../lib/all-tools';
import { customerPageSession } from '../../../lib/customer-page-session';
import { uxSwitchOn } from '../../../lib/ux-switches';
import { AllToolsFinder } from './all-tools-finder';
import { allToolsHelper } from '../frame-copy';
import './all-tools.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'All tools | Corridra',
  robots: { index: false, follow: false },
};

/**
 * Every page a signed-in customer may open, each with a plain verb, so the shorter navigation never
 * hides one. Behind `CORRIDRA_UX_NAV`: with the switch off this address does not exist.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; group?: string | string[] }>;
}) {
  if (!uxSwitchOn('CORRIDRA_UX_NAV')) notFound();
  const query = await searchParams;
  const word = (value: string | string[] | undefined) =>
    (Array.isArray(value) ? value[0] : value) ?? '';
  const session = await customerPageSession();
  if (!session.ok)
    return (
      <WorkspaceShell eyebrow="YOUR ACCOUNT" title="All tools are unavailable." compact>
        <p role="status">{session.message}</p>
        <a className="text-link" href="/account">
          Return to your account
        </a>
      </WorkspaceShell>
    );
  const listed = toolsFor({
    move: uxSwitchOn('CORRIDRA_UX_MOVE'),
    serviceRequests: customerServiceRequestsEnabled(),
    participants: customerParticipantsEnabled(),
    programmes: customerProgrammesEnabled(),
    companies: customerCompaniesEnabled(),
    profiles: customerOrganisationProfilesEnabled(),
    billing: customerBillingEnabled(),
    notifications: customerNotificationsEnabled(),
  });
  return (
    <CustomerShell
      tab="more"
      eyebrow="ALL TOOLS"
      title="Every tool you can open."
      frame={{ helper: allToolsHelper }}
    >
      <AllToolsFinder
        tools={listed.map(({ href, label, line, group }) => ({ href, label, line, group }))}
        initialQuery={word(query.q).slice(0, 80)}
        initialGroup={word(query.group)}
      />
    </CustomerShell>
  );
}
