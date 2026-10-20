import type { ReactNode } from 'react';

/** Layout only. Identity, scope and access decisions stay in the calling route. */
export function WorkspaceShell({
  eyebrow,
  title,
  children,
  compact = false,
  nav,
  notice,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  compact?: boolean;
  /** Navigation shown under the heading, for example the customer tabs. */
  nav?: ReactNode;
  /** A standing notice shown above the navigation, for example the test-mode banner. */
  notice?: ReactNode;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className={`operator-page ux-workspace${compact ? ' ux-access' : ''}${nav ? ' ux-customer' : ''}`}
    >
      <header className="ux-page-heading">
        <p className="label">{eyebrow}</p>
        <h1>{title}</h1>
      </header>
      {notice}
      {nav}
      {children}
    </main>
  );
}
