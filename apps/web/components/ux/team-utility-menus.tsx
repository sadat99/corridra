'use client';
// The team header's account menu behind the avatar (Navigation v1, UtilityMenus board): who is signed in and
// their access, the places an Admin-less role has no other door to (Authenticator, and Health and Readiness
// for a role that may open them), and Sign Out last. Below 640 px the language and help menus are in here
// too, so nothing is lost on a phone. It reads only what the team shell already knows (the role); it makes
// no call of its own and grants nothing: each page and action still checks on the server. Owner: S4.
import './utility-menus.css';
import { useState, useSyncExternalStore } from 'react';
import { identityClient } from '@corridra/auth/client';
import { CorridraIcon } from '../corridra-icon';
import { operatorSignInPage } from '../../lib/workspace-navigation';
import { customerHelpGroups } from '../../lib/ux/customer-navigation';
import { teamAccountLinks } from '../../lib/ux/team-map';
import { readServerTeamFlags, readTeamFlags, subscribeTeamFlags } from '../../lib/ux/team-flags';
import {
  readServerTeamContext,
  readTeamContext,
  subscribeTeamContext,
} from '../../lib/ux/team-context';
import { LanguageMenuGroup } from './customer-bar';
import { MenuLink } from './menu-link';
import { MenuButton, OverflowMenu } from './overflow-menu';
import { Entry, useListen } from './utility-menus';

function SignOutRow() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function signOut() {
    setBusy(true);
    setMessage('');
    try {
      const result = await identityClient.signOut();
      if (result.error) throw new Error();
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

export function TeamAccountMenu() {
  const listen = useListen();
  const { tenant, role } = useSyncExternalStore(
    subscribeTeamContext,
    readTeamContext,
    readServerTeamContext,
  );
  const { urls } = useSyncExternalStore(subscribeTeamFlags, readTeamFlags, readServerTeamFlags);
  const links = teamAccountLinks(role, urls, tenant);
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
          <strong>Team workspace</strong>
          <span>Your access: {role}</span>
        </div>
      ) : null}
      {links.length > 0 ? (
        <div role="group" aria-label="Account" className="ux-menu-group">
          {links.map((link) => (
            <MenuLink key={link.id} href={link.href}>
              {link.label}
            </MenuLink>
          ))}
        </div>
      ) : null}
      {/* Below 640 px the language and help menus are not in the header row; they are here, so nothing is lost. */}
      <div className="ux-phone-only">
        <div className="ux-menu-group">
          <p className="ux-menu-heading" aria-hidden="true">
            Language
          </p>
          <LanguageMenuGroup />
        </div>
        {customerHelpGroups().map((group) => (
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
