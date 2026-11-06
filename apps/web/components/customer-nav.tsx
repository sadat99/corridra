import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';
import { T } from './language-provider';
import { LocaleNav } from './ux/locale-region';
import type { MessageKey } from '../lib/i18n/messages';

export type CustomerTab = 'home' | 'move' | 'work' | 'companies' | 'meetings' | 'results' | 'more';

export const customerNavIcons: Record<CustomerTab, string> = {
  home: 'home',
  move: 'home',
  work: 'work',
  companies: 'company',
  meetings: 'calendar',
  results: 'progress',
  more: 'more',
};

export type CustomerNavItem = { tab: CustomerTab; label: string; href: string };

/**
 * The customer destinations in their locked order, shared by the top tab row below and the left bar
 * (components/customer-shell.tsx), so both always list the same names and addresses. Companies appears only
 * where the approved-companies module is on.
 */
export function customerNavItems({
  companies = false,
  plainNames = false,
  move = false,
}: {
  companies?: boolean;
  plainNames?: boolean;
  move?: boolean;
}): CustomerNavItem[] {
  return plainNames
    ? [
        move
          ? { tab: 'move', label: 'Home', href: '/account/move' }
          : { tab: 'home', label: 'Home', href: '/account' },
        { tab: 'work', label: 'Requests', href: '/account?view=work' },
        ...(companies
          ? [{ tab: 'companies' as const, label: 'Companies', href: '/account/companies' }]
          : []),
        { tab: 'results', label: 'Reports', href: '/account?view=results' },
        { tab: 'more', label: 'Account', href: '/account?view=more' },
      ]
    : [
        { tab: 'home', label: 'Home', href: '/account' },
        { tab: 'work', label: 'Requests', href: '/account?view=work' },
        ...(companies
          ? [{ tab: 'companies' as const, label: 'Companies', href: '/account/companies' }]
          : []),
        { tab: 'results', label: 'Reports', href: '/account?view=results' },
        { tab: 'more', label: 'Account', href: '/account?view=more' },
      ];
}

/**
 * The customer navigation: Home, Requests, Companies, Reports, Account.
 * A top row on wide screens and a bottom tab bar on phones. Every item is a real destination;
 * Companies appears only where the approved-companies module is on.
 */
export function CustomerNav({
  current,
  companies = false,
  plainNames = false,
  move = false,
  translated = false,
}: {
  /** `CORRIDRA_UX_SHELLS_V2`: tab names follow the chosen language and its direction. */
  translated?: boolean;
  current: CustomerTab;
  /** True where the approved-companies module is on. */
  companies?: boolean;
  /** `CORRIDRA_UX_NAV` retains its route/icon behavior; labels use the current vocabulary. */
  plainNames?: boolean;
  /** `CORRIDRA_UX_MOVE` links Home to the Move page when `plainNames` is on. */
  move?: boolean;
}) {
  const items = customerNavItems({ companies, plainNames, move });
  // With Your Move as the first tab, the older Home view stays reachable by its address and is read as the same place.
  const here = plainNames && move && current === 'home' ? 'move' : current;
  const links = items.map((item) => (
    <Link
      key={item.tab}
      prefetch={false}
      href={item.href}
      aria-current={item.tab === here ? 'page' : undefined}
    >
      <CorridraIcon
        name={plainNames && item.tab === 'results' ? 'library' : customerNavIcons[item.tab]}
      />
      <span>
        {translated ? <T k={customerNavLabelKeys[item.label] ?? 'wse.nav.more'} /> : item.label}
      </span>
    </Link>
  ));
  // With the shells switch on the tabs follow the chosen language and direction (CQ-10).
  if (translated)
    return (
      <LocaleNav className="guide-tabs" labelKey="wse.nav.customer">
        {links}
      </LocaleNav>
    );
  return (
    <nav className="guide-tabs" aria-label="Customer navigation">
      {links}
    </nav>
  );
}

export const customerNavLabelKeys: Record<string, MessageKey> = {
  Home: 'wse.nav.home',
  Requests: 'wse.nav.work',
  Companies: 'wse.nav.companies',
  Reports: 'wse.nav.results',
  Account: 'wse.nav.more',
};
