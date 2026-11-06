import { realUseEnabled } from '@corridra/auth/customer-production';
import type { ReactNode } from 'react';
import { customerBillingEnabled } from '@corridra/auth/customer-billing';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { uxSwitchOn } from '../lib/ux-switches';
import { CustomerNav, type CustomerTab } from './customer-nav';
import { T } from './language-provider';
import { customerTabs, type CustomerTabKey } from '../lib/ux/customer-navigation';
import type { MessageKey } from '../lib/i18n/messages';
import { CustomerTabs } from './ux/customer-tabs';
import { CustomerBarNote } from './ux/customer-bar-note';
import { LeftNavFrame, LeftNavList, type LeftNavItem } from './ux/left-nav';
import { CustomerRailFoot, CustomerRailTop } from './ux/customer-rail';
import { WorkspaceShell } from './workspace-shell';

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
export function CustomerShell({
  tab,
  eyebrow,
  title,
  count,
  children,
}: {
  tab: CustomerTab;
  /** Shown only while the shells switch is off; the left-bar frame has no eyebrow. */
  eyebrow?: string;
  title: ReactNode;
  /** What waits for the person, shown as a small count beside Home in the left bar. */
  count?: number;
  children: ReactNode;
}) {
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
  // Navigation v1: the sidebar (1024 px and wider) and the labelled bottom tabs (below) list the same five
  // destinations from one model. Account, Company Profile, Plan and Billing and the rest are under the avatar.
  const tabs = customerTabs({ companies: customerCompaniesEnabled(), move });
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
  const labelKeys: Partial<Record<CustomerTabKey, MessageKey>> = {
    home: 'wse.nav.home',
    requests: 'wse.nav.work',
    companies: 'wse.nav.companies',
    reports: 'wse.nav.results',
  };
  const items: LeftNavItem[] = tabs.map((item) => ({
    key: item.key,
    // Meetings is a new word with no reviewed translation yet, so it is marked as English.
    label: labelKeys[item.key] ? (
      <T k={labelKeys[item.key]!} />
    ) : (
      <span lang="en">{item.label}</span>
    ),
    href: item.href,
    icon: item.icon,
    count: item.key === 'home' && here === 'home' ? count : undefined,
  }));
  return (
    <LeftNavFrame
      navId={navId}
      words={words}
      narrow="tabs"
      nav={<LeftNavList id={navId} label={words.navLabel} items={items} current={here ?? ''} />}
      top={<CustomerRailTop />}
      foot={<CustomerRailFoot />}
    >
      <CustomerBarNote
        billing={customerBillingEnabled()}
        text={
          real
            ? 'Your work stays private to the people given access.'
            : 'Preview workspace: use made-up names and details here.'
        }
      />
      <WorkspaceShell title={title} customer>
        {children}
      </WorkspaceShell>
      <CustomerTabs tabs={tabs} current={here} count={here === 'home' ? count : undefined} />
    </LeftNavFrame>
  );
}
