'use client';
// The customer sidebar's top and foot (navigation v1, CustomerDesktop board). The top is the one primary action,
// New Request. The foot is Help on WhatsApp: a link that opens WhatsApp in a new tab when the owner has set a
// support number, and otherwise plain text with a Coming soon tag, never a link that does nothing. The workspace
// choice, the person and Help moved to the header menus
// (utility-menus.tsx). It reads only the person's workspaces; nothing here decides access, and every page and
// action still checks on the server.
import './customer-rail.css';
import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { CorridraIcon } from '../corridra-icon';
import { OperatorIcon } from '../operator-icon';
import { customerGroupHere, newRequestHref } from '../../lib/ux/customer-navigation';
import { useWorkspaces } from './customer-bar';

/** New Request: a person with a workspace goes to where requests are made, otherwise to the plan page. */
export function NewRequestLink({ className = 'ux-rail-new' }: { className?: string }) {
  const pathname = usePathname() ?? '';
  const workspaces = useWorkspaces(pathname.startsWith('/account'));
  return (
    <Link
      prefetch={false}
      className={className}
      href={newRequestHref(!!workspaces && workspaces.length > 0)}
    >
      <CorridraIcon name="draft" className="ux-rail-new-icon" />
      <span>New Request</span>
    </Link>
  );
}

/**
 * The name of a foot row when the bar is collapsed to icons. The words are kept for assistive technology (see
 * customer-rail.css) and, for everyone else, shown beside the icon while the pointer is on the row or keyboard focus is
 * on it. They go on Esc (without moving focus) and when the pointer or focus leaves; the pointer can move onto the
 * words without them closing, as they are inside the row. It only shows in the collapsed bar from 1024 px (the css
 * decides that); touch has no hover and gets none. W6-A.
 */
function useRailTip(focusable: boolean) {
  const row = useRef<HTMLElement | null>(null);
  const [tip, setTip] = useState<'off' | 'on' | 'dismissed'>('off');
  const place = () => {
    const el = row.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    // The words start at the row's edge and are pushed out past the bar's edge, 8 px clear of it.
    const bar = el.closest('.ux-leftnav-rail')?.getBoundingClientRect() ?? box;
    const gap = (rtl ? box.left - bar.left : bar.right - box.right) + 8;
    el.style.setProperty('--tip-x', `${rtl ? window.innerWidth - box.left : box.right}px`);
    el.style.setProperty('--tip-y', `${box.top + box.height / 2}px`);
    el.style.setProperty('--tip-gap', `${Math.max(gap, 8)}px`);
  };
  useEffect(() => {
    if (tip !== 'on') return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setTip('dismissed');
    };
    document.addEventListener('keydown', close, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('keydown', close, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [tip]);
  const show = () => {
    // Only the collapsed bar from 1024 px has words to show; anywhere else the tip stays off, so no key is taken.
    const el = row.current;
    if (
      !el?.closest("[data-collapsed='true']") ||
      !window.matchMedia('(min-width: 1024px)').matches
    )
      return;
    place();
    setTip((now) => (now === 'dismissed' ? now : 'on'));
  };
  return {
    ref: (el: HTMLElement | null) => {
      row.current = el;
    },
    // Rendered only while shown or dismissed, so the server markup carries no state.
    'data-tip': tip === 'off' ? undefined : tip,
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== 'touch') show();
    },
    onPointerLeave: () => setTip('off'),
    // A row that is not a link is not a keyboard stop, so it has no focus handlers.
    onFocus: focusable
      ? (event: FocusEvent) => {
          if (event.currentTarget.matches(':focus-visible')) show();
        }
      : undefined,
    onBlur: focusable ? () => setTip('off') : undefined,
  };
}

export type CustomerSideItem = {
  key: string;
  label: ReactNode;
  href: string;
  icon?: string;
  tone?: 'action' | 'positive' | 'ornament';
  lead?: boolean;
  count?: number;
};

function SideLink({ item, current }: { item: CustomerSideItem; current: boolean }) {
  return (
    <Link
      prefetch={false}
      href={item.href}
      aria-current={current ? 'page' : undefined}
      data-lead={item.lead ? 'true' : undefined}
    >
      {item.icon ? (
        <OperatorIcon name={item.icon} />
      ) : (
        <i className="ux-customer-nav-dot" data-tone={item.tone} aria-hidden="true" />
      )}
      <span>{item.label}</span>
      {item.count ? (
        <span className="ux-leftnav-count" aria-hidden="true">
          {item.count}
        </span>
      ) : null}
    </Link>
  );
}

function SideGroup({
  id,
  label,
  items,
  here,
}: {
  id: string;
  label: string;
  items: readonly CustomerSideItem[];
  here: string | null;
}) {
  // A group with no visible item is not drawn.
  if (!items.length) return null;
  return (
    <div className="ux-customer-nav-group">
      <p className="ux-customer-nav-label" id={id}>
        {label}
      </p>
      <ul aria-labelledby={id}>
        {items.map((item) => (
          <li key={item.key}>
            <SideLink item={item} current={item.key === here} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The customer sidebar's list (owner-approved mockups, revision 2, 12 Nov 2026): the five destinations in their
 * fixed order, then Your Journeys and Groups, which list pages that were reachable only from links inside pages. The
 * same markup and targets as the shared flat list (left-nav.tsx), so the drawer, the collapse to icons and the team
 * shell are unchanged. A Groups link is marked current on its own page instead of the destination above it.
 */
export function CustomerSideNav({
  id,
  label,
  items,
  current,
  journeys,
  groups,
}: {
  id: string;
  label: string;
  items: readonly CustomerSideItem[];
  current: string;
  journeys: readonly CustomerSideItem[];
  groups: readonly CustomerSideItem[];
}) {
  const pathname = usePathname() ?? '';
  const groupHere = customerGroupHere(pathname);
  const here = groupHere && groups.some((item) => item.key === groupHere) ? groupHere : null;
  return (
    <nav
      id={id}
      tabIndex={-1}
      className="ux-team-sidebar ux-leftnav-list ux-customer-nav"
      aria-label={label}
    >
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <SideLink item={item} current={!here && item.key === current} />
          </li>
        ))}
      </ul>
      <SideGroup id={`${id}-journeys`} label="Your Journeys" items={journeys} here={null} />
      <SideGroup id={`${id}-groups`} label="Groups" items={groups} here={here} />
    </nav>
  );
}

export function CustomerRailTop() {
  return <NewRequestLink />;
}

/**
 * Help on WhatsApp. `href` is the owner's support link; without it the row says Coming soon, as it always did.
 * `allTools` adds the All Tools link first in the foot (the one place the signed-in frame links to that page on
 * a wide screen); left off, the markup is exactly what it was. The name of the Help row is in a span of its own
 * (`ux-rail-label`), which the collapsed bar shows beside the icon on hover and focus.
 */
export function CustomerRailFoot({ href, allTools }: { href?: string | null; allTools?: boolean }) {
  return (
    <div className="ux-rail-foot">
      {allTools ? <RailAllTools /> : null}
      {href ? <RailHelpLink href={href} /> : <RailHelpSoon />}
    </div>
  );
}

function RailAllTools() {
  return (
    <Link prefetch={false} className="ux-rail-tools" href="/account/all-tools">
      <CorridraIcon name="grid" />
      <span>All Tools</span>
    </Link>
  );
}

function RailHelpLink({ href }: { href: string }) {
  const tip = useRailTip(true);
  return (
    <a
      className="ux-rail-help"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      lang="en"
      {...tip}
    >
      <CorridraIcon name="help" />
      <span className="ux-rail-label">Help on WhatsApp</span>
      <CorridraIcon name="open" className="ux-rail-help-open" />
      <span className="sr-only"> (opens WhatsApp outside Corridra, in a new tab)</span>
    </a>
  );
}

/** Not a link, so it is not a keyboard stop and its words show on hover only; they are in the page for assistive technology. */
function RailHelpSoon() {
  const tip = useRailTip(false);
  return (
    <p className="ux-rail-soon" {...tip}>
      <CorridraIcon name="help" />
      <span className="ux-rail-label">
        <span>Help on WhatsApp</span>
        <span className="ux-soon-tag">Coming soon</span>
      </span>
    </p>
  );
}
