'use client';
// The customer header row (navigation v1, CustomerDesktop board): on phones the compact New Request, then the
// Listen and language code (top bar), the notifications bell, the help and accessibility menu and the avatar menu. Below 640 px the
// language and help menus live inside the avatar menu so the row fits. The sidebar carries the wide New Request.
// It reads only what the signed-in header already reads; nothing here decides access, and every page and action
// still checks on the server.
import './customer-bar.css';
import { usePathname } from 'next/navigation';
import { CustomerSearch } from './customer-search';
import { NewRequestLink } from './customer-rail';
import { TopBarTools } from './top-bar';
import { AvatarMenu, HelpMenu, NotificationsPanel, useCustomerHelpGroups } from './utility-menus';

export function CustomerBar({
  notifications,
  whatsappHref,
}: {
  notifications: boolean;
  /** The support WhatsApp link, when the owner has set a number; absent, Chat on WhatsApp says Coming soon. */
  whatsappHref?: string;
}) {
  const pathname = usePathname() ?? '';
  const onAccount = pathname === '/account' || pathname.startsWith('/account/');
  const helpGroups = useCustomerHelpGroups(whatsappHref);
  return (
    <div className="ux-bar-tools">
      <CustomerSearch />
      <NewRequestLink className="ux-bar-primary ux-bar-new-narrow" />
      {/* UI/UX.v4 top bar (owner option 1a): Listen and the language as its code, icon plus word. Under 360 px the drawer holds them. */}
      <div className="ux-bar-topbar">
        <TopBarTools />
      </div>
      {notifications ? (
        <NotificationsPanel counted={onAccount} endpoint="/api/customer-inbox" />
      ) : null}
      <HelpMenu groups={helpGroups} />
      <AvatarMenu active={onAccount} whatsappHref={whatsappHref} />
    </div>
  );
}
