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
  above,
  lead,
  quietTitle = false,
}: {
  className?: string;
  /** A small label above the title. Customer pages show none (customer experience spec). */
  eyebrow?: string;
  title: ReactNode;
  children: ReactNode;
  compact?: boolean;
  /** Navigation shown under the heading, for example the customer tabs. */
  nav?: ReactNode;
  /** A standing notice shown above the navigation, for example the test-mode banner. */
  notice?: ReactNode;
  /** The signed-in customer frame: keeps the customer styles without the tab row under the heading. */
  customer?: boolean;
  /** Frame content above the title (back link, status chips). Nothing is drawn when it is left out. */
  above?: ReactNode;
  /** Frame content under the title (the helper line and the one primary action). Nothing is drawn when left out. */
  lead?: ReactNode;
  /** The page draws its own h1 (Your Move's honest lede), so the shell draws the title as a quiet line instead. */
  quietTitle?: boolean;
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
        {above}
        {quietTitle ? (
          <p className="move-greeting">{title}</p>
        ) : (
          <>
            {eyebrow ? <p className="label">{eyebrow}</p> : null}
            <h1>{title}</h1>
          </>
        )}
        {lead}
      </header>
      {notice}
      {nav}
      {children}
    </main>
  );
}
