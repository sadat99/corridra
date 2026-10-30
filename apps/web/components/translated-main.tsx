'use client';
import type { ReactNode } from 'react';
import { defaultLocale, localeMeta, type Locale } from '../lib/i18n/locales';
import { useLanguage } from './language-provider';

/**
 * The main region of a page that is on message files. While the page switch is off its words are English, so the
 * region says so itself and nothing changes. With the switch on it carries the chosen language and direction, so
 * the browser, screen readers and Listen all read it in the language it is written in. A page with its own release
 * (the request form) says which language its words are in, and the home page release then plays no part.
 */
export function TranslatedMain({
  className,
  language,
  children,
}: {
  className: string;
  language?: Locale;
  children: ReactNode;
}) {
  const { locale, pages } = useLanguage();
  const meta = localeMeta[language ?? (pages ? locale : defaultLocale)];
  return (
    <main id="main" lang={meta.html} dir={meta.dir} tabIndex={-1} className={className}>
      {children}
    </main>
  );
}
