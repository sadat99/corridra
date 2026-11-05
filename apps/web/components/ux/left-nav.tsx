'use client';
// The left navigation of a signed-in shell: ONE component the team, contributor and customer shells
// share (layout budget, docs/revamp/specs/layout-budget.md section 1; reference test
// tests/ux/left-nav.spec.ts).
//
//   1024 px and wider: always visible beside the page, 17 rem, and it collapses to icons (the choice is
//     kept on this device; losing it is harmless).
//   Below 1024 px: a left drawer opened from the menu button in the header. The drawer is a modal
//     dialog while open: focus moves into it and stays in it, Escape and the scrim close it and put
//     focus back on the button, a navigation closes it, the page behind it is inert. Growing past
//     1024 px closes it.
//
// `LeftNavFrame` wraps any navigation (the team sidebar keeps its groups); `LeftNavList` is the flat
// list a simple shell uses. Every target is at least 44 px (shells.css); the current item carries
// aria-current. The drawer state lives in left-nav-store.ts and touches no session or auth code.
// Owner: S4.
import './shells.css';
import './left-nav.css';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { OperatorIcon } from '../operator-icon';
import {
  readLeftNav,
  readServerLeftNav,
  registerLeftNav,
  setLeftNavOpen,
  subscribeLeftNav,
} from './left-nav-store';

const wideQuery = '(min-width: 1024px)';
const collapsedKey = 'corridra.leftnav.collapsed';
const focusable =
  'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useWide() {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(wideQuery);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(wideQuery).matches,
    () => false,
  );
}

/** The menu button for the header. It renders nothing unless a left bar is on the page. */
export function LeftNavMenuButton() {
  const state = useSyncExternalStore(subscribeLeftNav, readLeftNav, readServerLeftNav);
  if (!state.present) return null;
  return (
    <button
      type="button"
      className="ux-app-button ux-leftnav-opener"
      data-leftnav-opener=""
      aria-expanded={state.open}
      aria-controls={state.controls}
      onClick={() => setLeftNavOpen(!state.open)}
    >
      {state.label}
    </button>
  );
}

export type LeftNavWords = {
  /** The accessible name of the drawer while it is open. */
  navLabel: string;
  /** The words on the header menu button. */
  menuLabel: string;
  closeLabel: string;
  collapseLabel: string;
  expandLabel: string;
};

export function LeftNavFrame({
  navId,
  words,
  lang,
  dir,
  nav,
  children,
}: {
  /** The id of the navigation element inside `nav`; the menu button and collapse control point at it. */
  navId: string;
  words: LeftNavWords;
  lang?: string;
  dir?: 'ltr' | 'rtl';
  nav: ReactNode;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(subscribeLeftNav, readLeftNav, readServerLeftNav);
  const wide = useWide();
  const open = state.open && !wide;
  const [collapsed, setCollapsed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { menuLabel } = words;

  useEffect(() => registerLeftNav(navId, menuLabel), [navId, menuLabel]);
  // Growing past 1024 px closes the drawer: a wide screen has the bar beside the page instead.
  useEffect(() => {
    if (wide) setLeftNavOpen(false);
  }, [wide]);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the saved choice is browser-only
      setCollapsed(window.localStorage.getItem(collapsedKey) === 'true');
    } catch {
      /* The bar starts expanded. */
    }
  }, []);
  // While the drawer is open focus moves into it, so the person is never left on the page behind.
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>(focusable);
    (first ?? panel.current)?.focus();
  }, [open]);

  // Escape closes the open drawer wherever focus is, and puts focus back on the menu button.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setLeftNavOpen(false);
      document.querySelector<HTMLElement>('[data-leftnav-opener]')?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const opener = () => document.querySelector<HTMLElement>('[data-leftnav-opener]');
  const close = (returnFocus: boolean) => {
    setLeftNavOpen(false);
    if (returnFocus) opener()?.focus();
  };
  const choose = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(collapsedKey, String(next));
    } catch {
      /* The choice still applies to this visit. */
    }
  };

  return (
    <div
      className="ux-leftnav-frame"
      data-collapsed={wide && collapsed ? 'true' : 'false'}
      lang={lang}
      dir={dir}
    >
      <div className="ux-leftnav-rail">
        {open ? (
          <div className="ux-leftnav-scrim" aria-hidden="true" onClick={() => close(true)} />
        ) : null}
        <div
          ref={panel}
          className="ux-leftnav-panel"
          data-open={open ? 'true' : 'false'}
          {...(open ? { role: 'dialog', 'aria-modal': true, 'aria-label': words.navLabel } : {})}
          tabIndex={open ? -1 : undefined}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key !== 'Tab') return;
            // A focus trap: Tab and Shift+Tab stay inside the open drawer.
            const items = [
              ...(panel.current?.querySelectorAll<HTMLElement>(focusable) ?? []),
            ].filter((el) => el.offsetParent !== null);
            if (!items.length) return;
            const first = items[0]!;
            const last = items[items.length - 1]!;
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }}
          onClickCapture={(event) => {
            const target = event.target as HTMLElement;
            // A navigation closes the drawer. Focus is not forced back to the button here: the page
            // that opens (or the section a # link shows) takes focus itself.
            if (open && target.closest('a[href]')) close(false);
            // A group opened while the bar is icons-only first widens the bar so its words show.
            if (wide && collapsed && target.closest('summary')) choose(false);
          }}
        >
          {open ? (
            <button type="button" className="ux-leftnav-close" onClick={() => close(true)}>
              {words.closeLabel}
            </button>
          ) : null}
          {nav}
          <button
            type="button"
            className="ux-leftnav-collapse"
            aria-expanded={!collapsed}
            aria-controls={navId}
            onClick={() => choose(!collapsed)}
          >
            <OperatorIcon name="chevron" />
            <span>{collapsed ? words.expandLabel : words.collapseLabel}</span>
          </button>
        </div>
      </div>
      <div className="ux-leftnav-page" inert={open}>
        {children}
      </div>
    </div>
  );
}

export type LeftNavItem = {
  key: string;
  label: ReactNode;
  href: string;
  icon: string;
  /** A full page load rather than a client-side link (a # link or a page the workspace reads once). */
  plain?: boolean;
};

/** The flat list a simple shell uses (contributor, customer). Same look and targets as the team bar. */
export function LeftNavList({
  id,
  label,
  items,
  current,
}: {
  id: string;
  label: string;
  items: readonly LeftNavItem[];
  /** The key of the current item. */
  current: string;
}) {
  return (
    <nav id={id} tabIndex={-1} className="ux-team-sidebar ux-leftnav-list" aria-label={label}>
      <ul>
        {items.map((item) => {
          const content = (
            <>
              <OperatorIcon name={item.icon} />
              <span>{item.label}</span>
            </>
          );
          const aria = item.key === current ? ('page' as const) : undefined;
          return (
            <li key={item.key}>
              {item.plain ? (
                <a href={item.href} aria-current={aria}>
                  {content}
                </a>
              ) : (
                <Link prefetch={false} href={item.href} aria-current={aria}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
