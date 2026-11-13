import { realUseEnabled } from '@corridra/auth/customer-production';
import { Suspense, type ReactNode } from 'react';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { customerAccountLifecycleEnabled } from '@corridra/auth/customer-account-lifecycle';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { customerOrganisationProfilesEnabled } from '@corridra/auth/customer-organisation-profiles';
import { uxSwitchOn } from '../lib/ux-switches';
import { CustomerNav, type CustomerTab } from './customer-nav';
import { T } from './language-provider';
import { customerProgrammesEnabled } from '@corridra/auth/customer-programmes';
import { customerParticipantsEnabled } from '@corridra/auth/customer-participants';
import { customerWorkspacesEnabled } from '@corridra/auth/customer-workspaces';
import { readNeonAuthConfig } from '@corridra/config';
import {
  customerGroupLinks,
  customerJourneyLinks,
  customerTabs,
  type CustomerTabKey,
} from '../lib/ux/customer-navigation';
import { readJourneyCounts } from '../lib/work-items/journey-counts-server';
import { notificationSettingsAvailable } from '../lib/ux/notification-settings';
import { supportWhatsappHref } from '../lib/ux/support-whatsapp';
import { CustomerTabs } from './ux/customer-tabs';
import { CustomerBarNote } from './ux/customer-bar-note';
import { CustomerBarIdentity } from './ux/customer-bar-identity';
import { LeftNavFrame } from './ux/left-nav';
import {
  CustomerRailFoot,
  CustomerRailTop,
  CustomerSideNav,
  type CustomerSideItem,
} from './ux/customer-rail';
import { WorkspaceShell } from './workspace-shell';
import { IdentifiedClosedAccountGate } from './customer-closed-account-server';

const navId = 'customer-navigation';
const words = {
  navLabel: 'Customer navigation',
  menuLabel: 'Menu',
  closeLabel: 'Close menu',
  collapseLabel: 'Collapse menu',
  expandLabel: 'Expand menu',
};

/**
 * The signed-in customer frame. With CORRIDRA_UX_SHELLS_V2 on (the switch that gives a signed-in page its
 * own header): the locked customer destinations as a left bar (a drawer below 1024 px) and the page heading,
 * with no eyebrow and no amber banner; the privacy or preview line is a quiet line in the account menu. The
 * slim header row, which holds the drawer opener, is in components/ux/app-header.tsx. With it off the header
 * is the public one and has no opener, so the frame is exactly what it was: eyebrow, notice and tab row.
 * Server only.
 */
export function CustomerShell(props: CustomerShellProps) {
  const frame = <CustomerFrame {...props} />;
  // With the account module off nothing is added: the frame is exactly what it was. A page that opts out
  // (`closedAccountReads`) is drawn for a closed account too; the closed-account screen then links to it.
  return customerAccountLifecycleEnabled() && !props.closedAccountReads ? (
    <IdentifiedClosedAccountGate>{frame}</IdentifiedClosedAccountGate>
  ) : (
    frame
  );
}

type CustomerShellProps = {
  tab: CustomerTab;
  /** Shown only while the shells switch is off; the left-bar frame has no eyebrow. */
  eyebrow?: string;
  title: ReactNode;
  /** What waits for the person, shown as a small count beside Home in the left bar. */
  count?: number;
  /**
   * The page is drawn for a closed account instead of the closed-account screen. Only for pages a closed account may still
   * use (reading its problem reports and removing their words, ADR-078 decision 4); every other page keeps the gate.
   */
  closedAccountReads?: boolean;
  children: ReactNode;
};

function CustomerFrame({ tab, eyebrow, title, count, children }: CustomerShellProps) {
  const plainNames = uxSwitchOn('CORRIDRA_UX_NAV');
  const move = uxSwitchOn('CORRIDRA_UX_MOVE');
  const translated = uxSwitchOn('CORRIDRA_UX_SHELLS_V2');
  const real = realUseEnabled();
  if (!translated)
    return (
      <WorkspaceShell
        eyebrow={eyebrow}
        title={title}
        notice={
          <p className="ux-testmode" role="note">
            {real ? (
              <>Your work stays private to the people given access.</>
            ) : (
              <>
                <strong>Preview workspace:</strong> use made-up names and details here.
              </>
            )}
          </p>
        }
        nav={
          <CustomerNav
            current={tab}
            companies={customerCompaniesEnabled()}
            plainNames={plainNames}
            move={move}
            translated={false}
          />
        }
      >
        {children}
      </WorkspaceShell>
    );
  // Navigation v1 and the owner's 12 Nov 2026 rule (main navigation on the left for every signed-in user): the
  // sidebar beside the page from 1024 px, and below that the same sidebar as a left drawer opened from the header's
  // Menu button, with the labelled bottom tabs kept as a shortcut. Both list the five destinations from one model. Account, Company Profile, Plan and Billing and the rest are under the avatar.
  // Home is Your Move only with both the navigation and the Move switches, exactly as the old list decided.
  const companies = customerCompaniesEnabled();
  const homeIsMove = plainNames && move;
  const tabs = customerTabs({ companies, move: homeIsMove });
  const here: CustomerTabKey | null =
    tab === 'home' || tab === 'move'
      ? 'home'
      : tab === 'work'
        ? 'requests'
        : tab === 'results'
          ? 'reports'
          : tab === 'companies' || tab === 'meetings'
            ? tab
            : null;
  const items: CustomerSideItem[] = tabs.map((item) => ({
    key: item.key,
    // Meetings is a new word with no reviewed translation yet, so it is marked as English.
    label: item.labelKey ? <T k={item.labelKey} /> : <span lang="en">{item.label}</span>,
    href: item.href,
    icon: item.icon,
    count: item.key === 'home' && here === 'home' ? count : undefined,
  }));
  // Your Journeys and Groups (owner-approved mockups, revision 2): pages that were reachable only from links inside
  // pages, now in the sidebar too, each under the same switch or gate as its page and its account-page link.
  const journeys: CustomerSideItem[] = customerJourneyLinks(move).map((link) => ({
    ...link,
    label: <span lang="en">{link.label}</span>,
  }));
  const groups: CustomerSideItem[] = customerGroupLinks({
    programmes: customerProgrammesEnabled(),
    registrations:
      customerParticipantsEnabled() &&
      customerWorkspacesEnabled() &&
      !!readNeonAuthConfig()?.NEON_AUTH_BASE_URL,
  }).map((link) => ({ ...link, label: <span lang="en">{link.label}</span> }));
  return (
    <LeftNavFrame
      navId={navId}
      words={words}
      nav={
        <CustomerSideNav
          id={navId}
          label={words.navLabel}
          items={items}
          current={here ?? ''}
          journeys={journeys}
          journeyCounts={journeys.length ? readJourneyCounts() : undefined}
          groups={groups}
        />
      }
      top={<CustomerRailTop />}
      foot={<CustomerRailFoot href={supportWhatsappHref()} allTools={plainNames} />}
    >
      <CustomerBarNote
        billing={customerBillingEnabled()}
        notificationSettings={notificationSettingsAvailable()}
        organisationProfiles={customerOrganisationProfilesEnabled()}
        companies={companies}
        move={homeIsMove}
        text={
          real
            ? 'Your work stays private to the people given access.'
            : 'Preview workspace: use made-up names and details here.'
        }
      />
      {/* Streams after the frame: the identity is for the header's Search only and nothing waits for it. */}
      <Suspense fallback={null}>
        <CustomerBarIdentity />
      </Suspense>
      <WorkspaceShell title={title} customer>
        {children}
      </WorkspaceShell>
      <CustomerTabs tabs={tabs} current={here} count={here === 'home' ? count : undefined} />
    </LeftNavFrame>
  );
}
