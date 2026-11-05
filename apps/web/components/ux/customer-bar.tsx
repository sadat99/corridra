'use client';
// The slim customer header row (customer experience spec): a workspace switcher where the page belongs to a
// workspace, one primary "New request", the inbox as an icon with its unread count, and an account menu that
// holds the name, the language, the website, the privacy notice and Sign out. No bordered text buttons.
// It reads only what the signed-in header already reads (the inbox, the workspaces and the session of the
// person looking); nothing here decides access, and every page and action still checks on the server.
import './customer-bar.css';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { CorridraIcon } from '../corridra-icon';
import { useLanguage } from '../language-provider';
import { useSignOut } from '../use-sign-out';
import { localeMeta } from '../../lib/i18n/locales';
import {
  readCustomerNote,
  readServerCustomerNote,
  subscribeCustomerNote,
} from './customer-bar-store';
import { NotificationInbox } from './notification-inbox';
import { MenuLink } from './menu-link';
import { MenuButton, MenuRadio, OverflowMenu } from './overflow-menu';

type Workspace = { id: string; name: string };
type Item = { readAt: string | null };

/** Pages that belong to one workspace: the section and the workspace id, so another workspace can be chosen. */
const scoped =
  /^\/account\/(request|drafts|billing|profile|delegations|service-requests)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/** Read only on the customer account pages, where New request and the switcher need them. */
function useWorkspaces(active: boolean) {
  const [list, setList] = useState<Workspace[] | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    fetch('/api/customer-workspaces', { cache: 'no-store', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { workspaces?: Workspace[] } | null) => {
        if (controller.signal.aborted) return;
        setList(
          Array.isArray(body?.workspaces)
            ? body.workspaces.filter((w) => typeof w.id === 'string' && typeof w.name === 'string')
            : null,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setList(null);
      });
    return () => controller.abort();
  }, [active]);
  return active ? list : null;
}

function WorkspaceSwitcher({ workspaces }: { workspaces: Workspace[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const match = scoped.exec(pathname);
  if (!match || workspaces.length < 2) return null;
  const [, section, current] = match;
  const here = workspaces.find((w) => w.id === current);
  return (
    <OverflowMenu
      label="Switch workspace"
      align="start"
      className="ux-bar-switcher"
      trigger={
        <>
          <span className="ux-bar-switcher-name">{here?.name ?? 'Workspace'}</span>
          <CorridraIcon name="chevron" className="ux-bar-chevron" />
        </>
      }
    >
      {workspaces.map((w) => (
        <MenuRadio
          key={w.id}
          checked={w.id === current}
          onClick={() => {
            router.push(`/account/${section}/${w.id}`);
          }}
          data-menu-close=""
        >
          {w.name}
        </MenuRadio>
      ))}
    </OverflowMenu>
  );
}

/** `counted`: read the unread count in the background. The list itself loads when it is opened. */
function CustomerInbox({ counted }: { counted: boolean }) {
  const [unread, setUnread] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-inbox`;
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const load = useCallback((signal?: AbortSignal) => {
    fetch('/api/customer-inbox', { cache: 'no-store', signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((items: Item[] | null) => {
        if (signal?.aborted) return;
        setUnread(Array.isArray(items) ? items.filter((i) => !i.readAt).length : null);
      })
      .catch(() => {
        if (!signal?.aborted) setUnread(null);
      });
  }, []);
  useEffect(() => {
    if (!counted) return;
    const controller = new AbortController();
    load(controller.signal);
    function visible() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [load, counted]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function toggle() {
    // Opening shows the list; closing reads the count again, because opened items are marked read.
    if (open) load();
    setOpen((value) => !value);
  }
  const countId = `${panelId}-count`;
  return (
    <div
      className="ux-app-inbox ux-bar-inbox"
      ref={wrapper}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          load();
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="ux-menu-button"
        aria-label="Inbox"
        aria-describedby={unread ? countId : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <CorridraIcon name="inbox" />
        {unread ? (
          <span className="ux-bar-count" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {unread ? (
        <span id={countId} className="sr-only">
          {unread} unread
        </span>
      ) : null}
      <div id={panelId} className="ux-app-popover" hidden={!open}>
        {open ? <NotificationInbox endpoint="/api/customer-inbox" /> : null}
      </div>
    </div>
  );
}

function AccountMenuBody() {
  const { locale, offered, choose, t } = useLanguage();
  const note = useSyncExternalStore(
    subscribeCustomerNote,
    readCustomerNote,
    readServerCustomerNote,
  );
  const { busy, message, signOut } = useSignOut();
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
    <>
      {who ? (
        <div role="group" aria-label="Signed in as" className="ux-menu-who">
          {who.name ? <strong>{who.name}</strong> : null}
          <span>{who.email}</span>
        </div>
      ) : null}
      {note ? <p className="ux-menu-note">{note}</p> : null}
      {offered.length > 1 ? (
        <div role="group" aria-label={t('language.label')}>
          {offered.map(({ code }) => (
            <MenuRadio
              key={code}
              checked={code === locale}
              lang={localeMeta[code].html}
              dir={localeMeta[code].dir}
              data-menu-close=""
              onClick={() => choose(code)}
            >
              {localeMeta[code].name}
            </MenuRadio>
          ))}
        </div>
      ) : null}
      <MenuLink href="/">Corridra Website</MenuLink>
      <MenuLink href="/privacy">Privacy Notice</MenuLink>
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

export function CustomerBar({ notifications }: { notifications: boolean }) {
  const pathname = usePathname() ?? '';
  const onAccount = pathname === '/account' || pathname.startsWith('/account/');
  const workspaces = useWorkspaces(onAccount);
  // A person with a workspace goes to the place where requests are made; otherwise to the plan page, as the
  // account Home does when requests are not switched on for them.
  const start =
    workspaces && workspaces.length > 0 ? '/account?view=work#customer-workspaces' : '/plan';
  return (
    <>
      {workspaces ? <WorkspaceSwitcher workspaces={workspaces} /> : null}
      <div className="ux-bar-tools">
        <Link prefetch={false} className="ux-bar-primary" href={start}>
          New Request
        </Link>
        {notifications ? <CustomerInbox counted={onAccount} /> : null}
        <OverflowMenu
          label="Account menu"
          trigger={<CorridraIcon name="people" />}
          className="ux-bar-account"
        >
          <AccountMenuBody />
        </OverflowMenu>
      </div>
    </>
  );
}
