import Link from 'next/link';
import { CorridraIcon } from './corridra-icon';

export type CustomerTab = 'home' | 'work' | 'companies' | 'results' | 'more';

const icons: Record<CustomerTab, string> = {
  home: 'home',
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
}: {
  current: CustomerTab;
  /** True where the approved-companies module is on. */
  companies?: boolean;
}) {
  const items: { tab: CustomerTab; label: string; href: string }[] = [
    { tab: 'home', label: 'Home', href: '/account' },
    { tab: 'work', label: 'My Work', href: '/account?view=work' },
    ...(companies
      ? [{ tab: 'companies' as const, label: 'Companies', href: '/account/companies' }]
      : []),
    { tab: 'results', label: 'Results', href: '/account?view=results' },
    { tab: 'more', label: 'More', href: '/account?view=more' },
  ];
  return (
    <nav className="guide-tabs" aria-label="Customer navigation">
      {items.map((item) => (
        <Link
          key={item.tab}
          prefetch={false}
          href={item.href}
          aria-current={item.tab === current ? 'page' : undefined}
        >
          <CorridraIcon name={icons[item.tab]} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
