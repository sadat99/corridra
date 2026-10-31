'use client';
// The Team shell frame (D14): a left sidebar beside the page on wide screens, and a "Sections"
// button that opens the same list on phones. Sign-in and recovery pages under /operator keep the
// plain public frame. Owner: WS-E.
import './shells.css';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useLanguage } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import { subscribeToHash } from '../../lib/address-store';
import { teamSidebarShown } from '../../lib/ux/shells';
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
  // The phone list is open for one page: a new page closes it. An old "Back to workspace sections"
  // link (#workspace-navigation) opens it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn !== null && openOn === pathname;
  const setOpen = (next: boolean | ((value: boolean) => boolean)) =>
    setOpenOn((typeof next === 'function' ? next(open) : next) ? pathname : null);
  useEffect(() => {
    const read = () => {
      if (window.location.hash === '#workspace-navigation') setOpenOn(window.location.pathname);
    };
    read();
    return subscribeToHash(read);
  }, []);
  if (!teamSidebarShown(pathname)) return <>{children}</>;
  const meta = localeMeta[locale];
  return (
    <div className="ux-team-frame" data-open={open ? 'true' : 'false'}>
      <div className="ux-team-rail" lang={meta.html} dir={meta.dir}>
        <button
          type="button"
          className="ux-team-toggle"
          aria-expanded={open}
          aria-controls="workspace-navigation"
          onClick={() => setOpen((value) => !value)}
        >
          {t('wse.shell.menu')}
        </button>
        <TeamSidebar urls={urls} ownerPage={ownerPage} />
      </div>
      <div className="ux-team-page">{children}</div>
    </div>
  );
}
