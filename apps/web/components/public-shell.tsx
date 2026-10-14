import type { ReactNode } from 'react';

export function PublicShell({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main id="main" tabIndex={-1} className={`ux-public ${className}`}>
      {children}
    </main>
  );
}
