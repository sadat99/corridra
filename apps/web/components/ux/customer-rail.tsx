'use client';
// The customer left bar's top and foot (owner-approved frame, 5 Nov 2026): the person's workspace at the top,
// Help and the person at the foot. It reads only what the customer header already reads (the person's
// workspaces and their own session); nothing here decides access, and every page still checks on the server.
import './customer-rail.css';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CornerDock } from '../corner-dock';
import { CorridraIcon } from '../corridra-icon';
import { workspacePage } from '../../lib/ux/workspace-pages';
import { AccountMenuBody, useWorkspaces } from './customer-bar';
import { MenuLink } from './menu-link';
import { MenuRadio, OverflowMenu } from './overflow-menu';

const initials = (text: string) =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('') || '?';

/**
 * The workspace card, the one workspace switcher. On a page that belongs to one workspace it names that
 * workspace, and choosing another keeps the person in the same section of the chosen workspace. Elsewhere it
 * names the only workspace, or "All workspaces", and opens a workspace's profile.
 */
export function CustomerRailTop() {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const workspaces = useWorkspaces(pathname.startsWith('/account'));
  if (!workspaces || workspaces.length === 0) return null;
  const match = workspacePage.exec(pathname);
  const section = match?.[1];
  const current = match ? workspaces.find((w) => w.id === match[2]) : undefined;
  const shown = current ?? (workspaces.length === 1 ? workspaces[0]! : null);
  const face = (
    <>
      <span className="ux-rail-mark" aria-hidden="true">
        {shown ? initials(shown.name) : workspaces.length}
      </span>
      <span className="ux-rail-words">
        <b>{shown ? shown.name : 'All workspaces'}</b>
        <small>{shown ? 'Workspace' : `${workspaces.length} workspaces`}</small>
      </span>
      <CorridraIcon name="chevron" className="ux-rail-chevron" />
    </>
  );
  return (
    <OverflowMenu
      label={current ? 'Switch workspace' : 'Your workspaces'}
      align="start"
      className="ux-rail-workspace"
      trigger={face}
    >
      {current && section
        ? workspaces.map((w) => (
            <MenuRadio
              key={w.id}
              checked={w.id === current.id}
              onClick={() => router.push(`/account/${section}/${w.id}`)}
              data-menu-close=""
            >
              {w.name}
            </MenuRadio>
          ))
        : workspaces.map((w) => (
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
