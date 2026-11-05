import { realUseEnabled } from '@corridra/auth/customer-production';
import type { ReactNode } from 'react';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { uxSwitchOn } from '../lib/ux-switches';
import {
  customerNavIcons,
  customerNavItems,
  customerNavLabelKeys,
  type CustomerTab,
} from './customer-nav';
import { T } from './language-provider';
import { CustomerBarNote } from './ux/customer-bar-note';
import { LeftNavFrame, LeftNavList, type LeftNavItem } from './ux/left-nav';
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
 * The signed-in customer frame: the locked customer destinations as a left bar (a drawer below 1024 px) and
 * the page heading. The slim header row is in components/ux/app-header.tsx. There is no eyebrow and no amber
 * banner: the privacy or preview line is a quiet line in the account menu. Server only.
 */
export function CustomerShell({
  tab,
  title,
  children,
}: {
  tab: CustomerTab;
  /** Accepted for the pages that still pass it; the customer frame shows no eyebrow. */
  eyebrow?: string;
  title: string;
  children: ReactNode;
}) {
  const plainNames = uxSwitchOn('CORRIDRA_UX_NAV');
  const move = uxSwitchOn('CORRIDRA_UX_MOVE');
  const translated = uxSwitchOn('CORRIDRA_UX_SHELLS_V2');
  const listed = customerNavItems({ companies: customerCompaniesEnabled(), plainNames, move });
  // With Your Move as the first tab, the older Home view stays reachable by its address and is read as the same place.
  const here = plainNames && move && tab === 'home' ? 'move' : tab;
  const items: LeftNavItem[] = listed.map((item) => ({
    key: item.tab,
    label: translated ? <T k={customerNavLabelKeys[item.label] ?? 'wse.nav.more'} /> : item.label,
    href: item.href,
    icon: plainNames && item.tab === 'results' ? 'library' : customerNavIcons[item.tab],
  }));
  // "All tools" sits at the bottom of the bar wherever that page is on.
  if (plainNames)
    items.push({ key: 'all-tools', label: 'All tools', href: '/account/all-tools', icon: 'grid' });
  return (
    <LeftNavFrame
      navId={navId}
      words={words}
      nav={<LeftNavList id={navId} label={words.navLabel} items={items} current={here} />}
    >
      <CustomerBarNote
        text={
          realUseEnabled()
            ? 'Your work stays private to the people given access.'
            : 'Preview workspace: use made-up names and details here.'
        }
      />
      <WorkspaceShell title={title} customer>
        {children}
      </WorkspaceShell>
    </LeftNavFrame>
  );
}
