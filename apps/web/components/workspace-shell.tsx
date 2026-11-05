import type { ReactNode } from 'react';

/** Layout only. Identity, scope and access decisions stay in the calling route. */
export function WorkspaceShell({
  eyebrow,
  title,
  children,
  compact = false,
  nav,
  notice,
  className = '',
  customer = false,
}: {
  className?: string;
  /** A small label above the title. Customer pages show none (customer experience spec). */
  eyebrow?: string;
  title: string;
  children: ReactNode;
  compact?: boolean;
  /** Navigation shown under the heading, for example the customer tabs. */
  nav?: ReactNode;
  /** A standing notice shown above the navigation, for example the test-mode banner. */
  notice?: ReactNode;
  /** The signed-in customer frame: keeps the customer styles without the tab row under the heading. */
  customer?: boolean;
}) {
  return (
    <main
      id="main"
      lang="en"
      dir="ltr"
      tabIndex={-1}
      className={`operator-page ux-workspace${compact ? ' ux-access' : ''}${nav || customer ? ' ux-customer' : ''} ${className}`}
    >
      <header className="ux-page-heading">
        {eyebrow ? <p className="label">{eyebrow}</p> : null}
        <h1>{title}</h1>
      </header>
      {notice}
      {nav}
      {children}
    </main>
  );
}
