'use client';
// The customer header row (navigation v1, CustomerDesktop board): on phones the compact New Request, then the
// language menu, the notifications bell, the help and accessibility menu and the avatar menu. Below 640 px the
// language and help menus live inside the avatar menu so the row fits. The sidebar carries the wide New Request.
// It reads only what the signed-in header already reads; nothing here decides access, and every page and action
// still checks on the server.
import './customer-bar.css';
import { usePathname } from 'next/navigation';
import { NewRequestLink } from './customer-rail';
import { AvatarMenu, HelpMenu, LanguageMenu, NotificationsPanel } from './utility-menus';

export function CustomerBar({ notifications }: { notifications: boolean }) {
  const pathname = usePathname() ?? '';
  const onAccount = pathname === '/account' || pathname.startsWith('/account/');
  return (
    <div className="ux-bar-tools">
      <NewRequestLink className="ux-bar-primary ux-bar-new-narrow" />
      <LanguageMenu />
      {notifications ? (
        <NotificationsPanel counted={onAccount} endpoint="/api/customer-inbox" />
      ) : null}
      <HelpMenu />
      <AvatarMenu active={onAccount} />
    </div>
  );
}
