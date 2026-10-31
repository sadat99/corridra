'use client';
// A piece of shell chrome that follows the chosen language and its direction (CQ-10). Page content
// that is still English keeps lang="en" dir="ltr" on its own region; translated chrome such as the
// customer tabs says which language it is in, so Arabic reads right to left. Owner: WS-E.
import type { ReactNode } from 'react';
import { localeMeta } from '../../lib/i18n/locales';
import { useLanguage } from '../language-provider';

export function LocaleNav({
  className,
  labelKey,
  children,
}: {
  className?: string;
  labelKey: 'wse.nav.customer' | 'wse.team.nav';
  children: ReactNode;
}) {
  const { locale, t } = useLanguage();
  const meta = localeMeta[locale];
  return (
    <nav className={className} aria-label={t(labelKey)} lang={meta.html} dir={meta.dir}>
      {children}
    </nav>
  );
}
