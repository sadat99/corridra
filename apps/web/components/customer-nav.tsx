import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';

export type CustomerTab = 'home' | 'move' | 'work' | 'companies' | 'results' | 'more';

const icons: Record<CustomerTab, string> = {
  home: 'home',
  move: 'home',
  work: 'work',
  companies: 'company',
  results: 'progress',
  more: 'more',
};

/**
 * The locked customer navigation: Home, My Work, Companies, Results, More.
 * A top row on wide screens and a bottom tab bar on phones. Every item is a real destination;
 * Companies appears only where the approved-companies module is on.
 */
export function CustomerNav({
  current,
  companies = false,
  plainNames = false,
  move = false,
}: {
  current: CustomerTab;
  /** True where the approved-companies module is on. */
  companies?: boolean;
  /** UX update (`CORRIDRA_UX_NAV`): Your Move, Missions, Companies, Library, More. Off renders exactly as before. */
  plainNames?: boolean;
  /** UX update (`CORRIDRA_UX_MOVE`): the first tab is Your Move. Needs `plainNames`; otherwise it keeps the word Home. */
  move?: boolean;
}) {
  const items: { tab: CustomerTab; label: string; href: string }[] = plainNames
    ? [
        move
          ? { tab: 'move', label: 'Your Move', href: '/account/move' }
          : { tab: 'home', label: 'Home', href: '/account' },
        { tab: 'work', label: 'Missions', href: '/account?view=work' },
        ...(companies
          ? [{ tab: 'companies' as const, label: 'Companies', href: '/account/companies' }]
          : []),
        { tab: 'results', label: 'Library', href: '/account?view=results' },
        { tab: 'more', label: 'More', href: '/account?view=more' },
      ]
    : [
        { tab: 'home', label: 'Home', href: '/account' },
        { tab: 'work', label: 'My Work', href: '/account?view=work' },
        ...(companies
          ? [{ tab: 'companies' as const, label: 'Companies', href: '/account/companies' }]
          : []),
        { tab: 'results', label: 'Results', href: '/account?view=results' },
        { tab: 'more', label: 'More', href: '/account?view=more' },
      ];
  // With Your Move as the first tab, the older Home view stays reachable by its address and is read as the same place.
  const here = plainNames && move && current === 'home' ? 'move' : current;
  return (
    <nav className="guide-tabs" aria-label="Customer navigation">
      {items.map((item) => (
        <Link
          key={item.tab}
          prefetch={false}
          href={item.href}
          aria-current={item.tab === here ? 'page' : undefined}
        >
          <CorridraIcon name={plainNames && item.tab === 'results' ? 'library' : icons[item.tab]} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
