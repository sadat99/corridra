'use client';
// The customer left bar's top and foot (owner-approved frame, 5 Nov 2026): the person's workspace at the top,
// Help and the person at the foot. It reads only what the customer header already reads (the person's
// workspaces and their own session); nothing here decides access, and every page still checks on the server.
import './customer-rail.css';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CornerDock } from '../corner-dock';
import { CorridraIcon } from '../corridra-icon';
import { AccountMenuBody, useWorkspaces } from './customer-bar';
import { MenuLink, OverflowMenu } from './overflow-menu';

const initials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || '?';

/** The workspace card: one workspace by name, or all of them with a menu to open any one. */
export function CustomerRailTop() {
  const pathname = usePathname() ?? '';
  const workspaces = useWorkspaces(pathname.startsWith('/account'));
  if (!workspaces || workspaces.length === 0) return null;
  const one = workspaces.length === 1 ? workspaces[0]! : null;
  const face = (
    <>
      <span className="ux-rail-mark" aria-hidden="true">
        {one ? initials(one.name) : workspaces.length}
      </span>
      <span className="ux-rail-words">
        <b>{one ? one.name : 'All workspaces'}</b>
        <small>{one ? 'Workspace' : `${workspaces.length} workspaces`}</small>
      </span>
      <CorridraIcon name="chevron" className="ux-rail-chevron" />
    </>
  );
  return (
    <OverflowMenu
      label="Your workspaces"
      align="start"
      className="ux-rail-workspace"
      trigger={face}
    >
      {workspaces.map((w) => (
        <MenuLink key={w.id} href={`/account/profile/${w.id}`}>
          {w.name}
        </MenuLink>
      ))}
      <MenuLink href="/account?view=work#customer-workspaces">Manage Workspaces</MenuLink>
    </OverflowMenu>
  );
}

/** Help, then the signed-in person with the account menu (language, website, privacy, Sign Out). */
export function CustomerRailFoot() {
  const [who, setWho] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/get-session', { cache: 'no-store', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { user?: { name?: unknown; email?: unknown } } | null) => {
        const user = body?.user;
        if (!controller.signal.aborted && user && typeof user.email === 'string')
          setWho({ name: typeof user.name === 'string' ? user.name : '', email: user.email });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <div className="ux-rail-foot">
      <CornerDock variant="rail" />
      <OverflowMenu
        label="Account menu"
        align="start"
        className="ux-rail-account"
        trigger={
          <>
            <span className="ux-rail-face" aria-hidden="true">
              {who ? initials(who.name || who.email) : <CorridraIcon name="people" />}
            </span>
            <span className="ux-rail-words">
              <b>{who?.name || 'Your account'}</b>
              {who ? <small>{who.email}</small> : null}
            </span>
          </>
        }
      >
        <AccountMenuBody />
      </OverflowMenu>
    </div>
  );
}
