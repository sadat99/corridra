import { realUseEnabled } from '@corridra/auth/customer-production';
import type { ReactNode } from 'react';
import { customerCompaniesEnabled } from '@corridra/auth/customer-companies';
import { uxSwitchOn } from '../lib/ux-switches';
import {
  CustomerNav,
  customerNavIcons,
  customerNavItems,
  customerNavLabelKeys,
  type CustomerTab,
} from './customer-nav';
import { T } from './language-provider';
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
  const listed = customerNavItems({ companies: customerCompaniesEnabled(), plainNames, move });
  // With Your Move as the first tab, the older Home view stays reachable by its address and is read as the same place.
  const here = plainNames && move && tab === 'home' ? 'move' : tab;
  const items: LeftNavItem[] = listed.map((item) => ({
    key: item.tab,
    label: translated ? <T k={customerNavLabelKeys[item.label] ?? 'wse.nav.more'} /> : item.label,
    href: item.href,
    icon: plainNames && item.tab === 'results' ? 'library' : customerNavIcons[item.tab],
    count: item.tab === here ? count : undefined,
  }));
  // "All tools" sits at the bottom of the bar wherever that page is on.
  if (plainNames)
    items.push({ key: 'all-tools', label: 'All tools', href: '/account/all-tools', icon: 'grid' });
  return (
    <LeftNavFrame
      navId={navId}
      words={words}
      nav={<LeftNavList id={navId} label={words.navLabel} items={items} current={here} />}
      top={<CustomerRailTop />}
      foot={<CustomerRailFoot />}
    >
      <CustomerBarNote
        text={
          real
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
