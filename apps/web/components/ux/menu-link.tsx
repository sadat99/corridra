import Link from 'next/link';
import type { ReactNode } from 'react';

/** A menu row that is a link in the app's own navigation. It sits in its own file so the menu itself needs no router. */
export function MenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link prefetch={false} role="menuitem" tabIndex={-1} className="ux-menu-row" href={href}>
      {children}
    </Link>
  );
}
