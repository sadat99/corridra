import type { ReactNode } from 'react';
import { TranslatedMain } from './translated-main';

export function PublicShell({
  children,
  className = '',
  translated = false,
}: {
  children: ReactNode;
  className?: string;
  /** True for a page whose words are keys in the message files; its main region then follows the language. */
  translated?: boolean;
}) {
  if (translated)
    return <TranslatedMain className={`ux-public ${className}`}>{children}</TranslatedMain>;
  return (
    <main id="main" lang="en" dir="ltr" tabIndex={-1} className={`ux-public ${className}`}>
      {children}
    </main>
  );
}
