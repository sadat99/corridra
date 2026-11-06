'use client';
// The Team shell frame (D14): the shared left navigation (components/ux/left-nav.tsx) holding the
// Navigation v1 sidebar. On wide screens the bar sits beside the page; on phones it is a drawer opened
// from the "Sections" button in the header. Sign-in and recovery pages under /operator keep the plain
// public frame. Owner: WS-E.
import './shells.css';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useLanguage } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import { subscribeToHash } from '../../lib/address-store';
import { teamSidebarShown } from '../../lib/ux/shells';
import { LeftNavFrame } from './left-nav';
import { setLeftNavOpen } from './left-nav-store';
import { useMarkedWord } from './marked-word';
import { StepUpDialog } from './step-up-dialog';
import { TeamSidebar } from './team-sidebar';

export function TeamFrame({
  children,
  urls,
  ownerPage,
}: {
  children: ReactNode;
  urls: boolean;
  ownerPage: boolean;
}) {
  const pathname = usePathname();
  const { locale, t } = useLanguage();
  const word = useMarkedWord();
  const shown = teamSidebarShown(pathname);
  // A new page closes the drawer. An old "Back to workspace sections" link (#workspace-navigation)
  // opens it (on a wide screen the bar is already beside the page).
  useEffect(() => {
    if (!shown) return;
    setLeftNavOpen(false);
    const read = () => {
      if (window.location.hash === '#workspace-navigation') setLeftNavOpen(true);
    };
    read();
    return subscribeToHash(read);
  }, [pathname, shown]);
  if (!shown) return <>{children}</>;
  const meta = localeMeta[locale];
  return (
    <>
      <LeftNavFrame
        navId="workspace-navigation"
        lang={meta.html}
        dir={meta.dir}
        words={{
          navLabel: t('wse.team.nav'),
          menuLabel: t('wse.shell.menu'),
          closeLabel: word('wse.shell.closeMenu'),
          collapseLabel: word('wse.shell.collapseMenu'),
          expandLabel: word('wse.shell.expandMenu'),
        }}
        nav={<TeamSidebar urls={urls} ownerPage={ownerPage} />}
      >
        {children}
      </LeftNavFrame>
      <StepUpDialog />
    </>
  );
}
