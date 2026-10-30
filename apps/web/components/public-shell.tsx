import type { ReactNode } from 'react';
import type { Locale } from '../lib/i18n/locales';
import { TranslatedMain } from './translated-main';

export function PublicShell({
  children,
  className = '',
  translated = false,
  language,
}: {
  children: ReactNode;
  className?: string;
  /** True for a page whose words are keys in the message files; its main region then follows the language. */
  translated?: boolean;
  /** For a translated page with its own release: the language its words are shown in. */
  language?: Locale;
}) {
  if (translated)
    return (
      <TranslatedMain className={`ux-public ${className}`} language={language}>
        {children}
      </TranslatedMain>
    );
  return (
    <main id="main" lang="en" dir="ltr" tabIndex={-1} className={`ux-public ${className}`}>
      {children}
    </main>
  );
}
