'use client';
// The team header's account menu behind the avatar (Navigation v1, UtilityMenus board): who is signed in and
// their access, the places an Admin-less role has no other door to (Authenticator, and Health and Readiness
// for a role that may open them), and Sign Out last. Below 640 px the language and help menus are in here
// too, so nothing is lost on a phone. It reads only what the team shell already knows (the role); it makes
// no call of its own and grants nothing: each page and action still checks on the server. Owner: S4.
import './utility-menus.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { CorridraIcon } from '../corridra-icon';
import { operatorSignInPage } from '../../lib/workspace-navigation';
import {
  teamHelpGroups,
  teamProblemReportsPath,
  teamReportProblemHref,
} from '../../lib/ux/team-help';
import { subscribeToHash } from '../../lib/address-store';
import { forgetDeviceRecents } from '../../lib/ux/palette-recents';
import { sectionForSlug } from '../../lib/operator-urls';
import { currentTeamSection } from '../../lib/ux/shells';
import { teamAccountLinks, type TeamPlaceId } from '../../lib/ux/team-map';
import { readServerTeamFlags, readTeamFlags, subscribeTeamFlags } from '../../lib/ux/team-flags';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';
import { useLanguage } from '../language-provider';
import { LanguageMenuGroup } from './customer-bar';
import { MenuButton, OverflowMenu } from './overflow-menu';
import { Entry, useListen } from './utility-menus';

const roleWords: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  operator: 'Operator',
  reviewer: 'Reviewer',
  viewer: 'Viewer',
};

/**
 * A menu row that leads to a team place. A `#` address, or any page that is not the workspace itself (a mission page,
 * the owner page), is a plain anchor, as in the sidebar: the workspace reads its section from `hashchange` and a soft
 * router change to a same-page `#` fires none, so the section would not switch.
 */
export function PlaceLink({
  href,
  current,
  plain,
  children,
}: {
  href: string;
  current: boolean;
  plain: boolean;
  children: ReactNode;
}) {
  const ariaCurrent = current ? ('page' as const) : undefined;
  return plain || href.includes('#') ? (
    <a role="menuitem" tabIndex={-1} className="ux-menu-row" href={href} aria-current={ariaCurrent}>
      {children}
    </a>
  ) : (
    <Link
      prefetch={false}
      role="menuitem"
      tabIndex={-1}
      className="ux-menu-row"
      href={href}
      aria-current={ariaCurrent}
    >
      {children}
    </Link>
  );
}

function SignOutRow() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function signOut() {
    setBusy(true);
    setMessage('');
    try {
      // The same request the sign-in SDK makes (`identityClient.signOut`), sent directly so the shared header does not
      // carry the SDK: the team header ships on every page of the shell.
      const response = await fetch('/api/operator-auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error();
      // The command palette's recent items are this person's, on this device: they go with the session.
      forgetDeviceRecents();
      // A full page load: it drops the cached workspace (see operatorSignInPage).
      window.location.replace(operatorSignInPage);
    } catch {
      setMessage('Sign-out could not be confirmed. Please try again.');
      setBusy(false);
    }
  }
  return (
    <>
      <MenuButton disabled={busy} onClick={signOut}>
        {busy ? 'Signing Out…' : 'Sign Out'}
      </MenuButton>
      {message ? (
        <p role="alert" className="ux-menu-note">
          {message}
        </p>
      ) : null}
    </>
  );
}

export function TeamAccountMenu({ whatsappHref }: { whatsappHref?: string | null }) {
  const listen = useListen();
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const { urls, problemReports } = useSyncExternalStore(
    subscribeTeamFlags,
    readTeamFlags,
    readServerTeamFlags,
  );
  const pathname = usePathname() ?? '/operator';
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => '',
  );
  const { offered } = useLanguage();
  const place = (currentTeamSection(pathname, hash, sectionForSlug) || 'home') as TeamPlaceId;
  const plain = pathname !== '/operator' && !sectionForSlug(pathname.split('/')[2] ?? '');
  const links = teamAccountLinks(
    role,
    urls,
    tenant,
    place,
    problemReports ? { current: pathname.startsWith(teamProblemReportsPath) } : undefined,
  );
  return (
    <OverflowMenu
      label="Account menu"
      className="ux-util-avatar"
      trigger={
        <span className="ux-avatar-face" aria-hidden="true">
          <CorridraIcon name="people" />
        </span>
      }
    >
      {role ? (
        <div role="group" aria-label="Signed in" className="ux-menu-who">
          <strong>Team Workspace</strong>
          <span>Your access: {roleWords[role] ?? role}</span>
        </div>
      ) : null}
      {links.length > 0 ? (
        <div role="group" aria-label="Account" className="ux-menu-group">
          {links.map((link) => (
            <PlaceLink key={link.id} href={link.href} current={link.current} plain={plain}>
              {link.label}
            </PlaceLink>
          ))}
        </div>
      ) : null}
      {/* Below 640 px the language and help menus are not in the header row; they are here, so nothing is lost. */}
      <div className="ux-phone-only">
        {offered.length > 1 ? (
          <div className="ux-menu-group">
            <p className="ux-menu-heading" aria-hidden="true">
              Language
            </p>
            <LanguageMenuGroup />
          </div>
        ) : null}
        {teamHelpGroups(
          whatsappHref,
          problemReports ? teamReportProblemHref(pathname, tenant) : null,
        ).map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className="ux-menu-group">
            <p className="ux-menu-heading" aria-hidden="true">
              {group.label}
            </p>
            {group.items.map((entry) => (
              <Entry key={entry.label} entry={entry} listen={listen} />
            ))}
          </div>
        ))}
      </div>
      <SignOutRow />
    </OverflowMenu>
  );
}
