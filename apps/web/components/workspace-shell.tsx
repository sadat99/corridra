import type { ReactNode } from 'react';

/** Layout only. Identity, scope and access decisions stay in the calling route. */
export function WorkspaceShell({
  eyebrow,
  title,
  children,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      className={`operator-page ux-workspace${compact ? ' ux-access' : ''}`}
    >
      <header className="ux-page-heading">
        <p className="label">{eyebrow}</p>
        <h1>{title}</h1>
      </header>
      {children}
    </main>
  );
}
