import Link from 'next/link';

export type CustomerTab = 'home' | 'work' | 'companies' | 'results' | 'more';

const icons: Record<CustomerTab, React.ReactNode> = {
  home: (
    <>
      <path d="M4 11 12 4l8 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  work: (
    <>
      <path d="M4 8h16v11H4z" />
      <path d="M9 8V6h6v2" />
      <path d="M4 13h16" />
    </>
  ),
  companies: (
    <>
      <path d="M5 21V4h9v17" />
      <path d="M14 10h5v11" />
      <path d="M8 8h3M8 12h3M8 16h3" />
    </>
  ),
  results: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
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
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {icons[item.tab]}
          </svg>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
