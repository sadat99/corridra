import { notFound } from 'next/navigation';
import Link from 'next/link';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { customerNotificationsEnabled } from '@corridra/auth/customer-notifications';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerServiceRequestsEnabled } from '@corridra/auth/customer-service-requests';
import { CustomerShell } from '../../../components/customer-shell';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { toolGroups, toolsFor } from '../../../lib/all-tools';
import { customerPageSession } from '../../../lib/customer-page-session';
import { uxSwitchOn } from '../../../lib/ux-switches';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'All tools | Corridra',
  robots: { index: false, follow: false },
};

/**
 * Every page a signed-in customer may open, each with a plain verb, so the shorter navigation never
 * hides one. Behind `CORRIDRA_UX_NAV`: with the switch off this address does not exist.
 */
export default async function Page() {
  if (!uxSwitchOn('CORRIDRA_UX_NAV')) notFound();
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
    <CustomerShell tab="more" eyebrow="ALL TOOLS" title="Every tool you can open.">
      {toolGroups.map((group) => {
        const inGroup = listed.filter((tool) => tool.group === group);
        if (inGroup.length === 0) return null;
        const id = `tools-${group.toLowerCase().replace(/\s+/g, '-')}`;
        return (
          <section key={group} className="guide-area ux-account-groups" aria-labelledby={id}>
            <h2 id={id}>{group}</h2>
            <ul className="ux-link-list">
              {inGroup.map((tool) => (
                <li key={tool.href}>
                  <Link prefetch={false} href={tool.href}>
                    <strong>{tool.label}</strong>
                    <span>{tool.line}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </CustomerShell>
  );
}
