'use client';
import type { ReactNode } from 'react';
import { localeMeta } from '../lib/i18n/locales';
import { useLanguage } from './language-provider';

/**
 * The main region of a page that is on message files. While the page switch is off its words are English, so the
 * region says so itself and nothing changes. With the switch on it carries the chosen language and direction, so
 * the browser, screen readers and Listen all read it in the language it is written in.
 */
export function TranslatedMain({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const { locale, pages } = useLanguage();
  const meta = pages ? localeMeta[locale] : localeMeta.en;
  return (
    <main id="main" lang={meta.html} dir={meta.dir} tabIndex={-1} className={className}>
      {children}
    </main>
  );
}
