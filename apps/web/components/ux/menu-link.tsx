import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * A menu row that is a link in the app's own navigation. It sits in its own file so the menu itself needs no router.
 * `describedBy`: the id of plain text in the menu that says more about where the row goes.
 */
export function MenuLink({
  href,
  describedBy,
  children,
}: {
  href: string;
  describedBy?: string;
  children: ReactNode;
}) {
  return (
    <Link
      prefetch={false}
      role="menuitem"
      tabIndex={-1}
      className="ux-menu-row"
      href={href}
      aria-describedby={describedBy}
    >
      {children}
    </Link>
  );
}
