'use client';
// The contributor shell frame: the shared left navigation with two items, Your tasks and How
// assigned work works. Sign-out stays where it is on the page. Navigation only: the page and the
// server still decide who sees what. Owner: WS-E.
import './shells.css';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useLanguage } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import { LeftNavFrame, LeftNavList } from './left-nav';
import { setLeftNavOpen } from './left-nav-store';
import { useMarkedWord } from './marked-word';

export function ContributorFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { locale, t } = useLanguage();
  const word = useMarkedWord();
  // A new page closes the drawer.
  useEffect(() => setLeftNavOpen(false), [pathname]);
  const meta = localeMeta[locale];
  return (
    <LeftNavFrame
      navId="contributor-navigation"
      lang={meta.html}
      dir={meta.dir}
      words={{
        navLabel: t('wse.contributor.nav'),
        menuLabel: t('wse.shell.menu'),
        closeLabel: word('wse.shell.closeMenu'),
        collapseLabel: word('wse.shell.collapseMenu'),
        expandLabel: word('wse.shell.expandMenu'),
      }}
      nav={
        <LeftNavList
          id="contributor-navigation"
          label={t('wse.contributor.nav')}
          current="tasks"
          items={[
            { key: 'tasks', label: t('wse.shell.contributor'), href: '/contributor', icon: 'home' },
            {
              key: 'how',
              label: word('wse.contributor.how'),
              href: '/network',
              icon: 'chevron',
            },
          ]}
        />
      }
    >
      {children}
    </LeftNavFrame>
  );
}
