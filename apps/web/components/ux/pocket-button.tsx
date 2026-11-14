'use client';
// Pocket (phone), UI/UX.v3 "Pocket (phone)": one floating button on signed-in customer pages that says the next thing
// to do (lib/ux/next-move.ts) and opens it on a tap. Press, slide up and release on a row of the list chooses it; the
// visible More button opens the same list for people who tap or use a keyboard. The list holds New Request, Continue
// Draft (only when a draft exists), Meetings, Search and Get Help, and Get Help is the whole existing help content
// (customerHelpGroups, the same rows the header Help menu draws), so nothing that left the phone header is lost.
//
// It reads nothing of its own: the signals come from the sidebar's work list through the shell, streamed, so the button
// is drawn at once as New Request and its words upgrade when the signals arrive. Every destination is an existing page
// that still checks on the server. Drawn on phones only (the stylesheet), never on a form step (lib/ux/pocket-pages.ts).
import './pocket-button.css';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { CorridraIcon } from '../corridra-icon';
import { useScrollHide } from '../corner-dock';
import { pocketHiddenOn } from '../../lib/ux/pocket-pages';
import { newRequestHref } from '../../lib/ux/customer-navigation';
import { nextMove, type PocketSignals } from '../../lib/ux/next-move';
import { Entry, useCustomerHelpGroups, useListen } from './utility-menus';

/** How far the press must travel upward before it counts as a slide and not a tap, in CSS px. */
const slideThreshold = 14;
/** Slack above and below a row while sliding, so a thumb between two rows still chooses the nearer one. */
const hitSlack = 6;
const openSearchEvent = 'corridra:open-customer-search';

type Row = {
  key: string;
  label: string;
  icon: string;
  href?: string;
  /** For a row that is an action, not a page. */
  run?: () => void;
};

/** True when the document is scrolled to its end, where the button gives way so the last row is never covered. */
function useAtEnd(enabled: boolean) {
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      const root = document.documentElement;
      const scrollable = root.scrollHeight - window.innerHeight > 80;
      setAtEnd(scrollable && window.innerHeight + window.scrollY >= root.scrollHeight - 8);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [enabled]);
  return atEnd;
}

export function PocketButton({
  signals,
  whatsappHref,
}: {
  /** The shell's streamed read of the sidebar's work list. Resolves to null when it could not be read. */
  signals?: Promise<PocketSignals | null>;
  whatsappHref?: string;
}) {
  const pathname = usePathname() ?? '';
  return pocketHiddenOn(pathname) ? null : (
    <PocketView signals={signals} whatsappHref={whatsappHref} />
  );
}

function PocketView({
  signals,
  whatsappHref,
}: {
  signals?: Promise<PocketSignals | null>;
  whatsappHref?: string;
}) {
  const [read, setRead] = useState<PocketSignals | null>(null);
  useEffect(() => {
    let live = true;
    signals?.then(
      (value) => {
        if (live) setRead(value);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [signals]);
  const move = nextMove(read);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'help'>('list');
  const [hot, setHot] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLAnchorElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const help = useRef<HTMLDivElement>(null);
  const press = useRef<{ y: number; slid: boolean; hot: number } | null>(null);
  const suppressUntil = useRef(0);
  const listId = `pocket-list-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const scrolledAway = useScrollHide(true);
  const atEnd = useAtEnd(true);
  const helpGroups = useCustomerHelpGroups(whatsappHref);
  const listen = useListen();

  const rows: Row[] = [
    { key: 'help', label: 'Get Help', icon: 'help', run: () => setView('help') },
    {
      key: 'search',
      label: 'Search',
      icon: 'search',
      run: () => window.dispatchEvent(new Event(openSearchEvent)),
    },
    { key: 'meetings', label: 'Meetings', icon: 'calendar', href: '/account/meetings' },
    ...(read?.drafts.href
      ? [{ key: 'draft', label: 'Continue Draft', icon: 'draft', href: read.drafts.href }]
      : []),
    {
      key: 'new',
      label: 'New Request',
      icon: 'draft',
      href: newRequestHref(read?.hasWorkspace ?? false),
    },
  ];

  const close = useCallback((returnFocus: 'more' | 'main' | null) => {
    setOpen(false);
    setView('list');
    setHot(-1);
    if (returnFocus === 'more') more.current?.focus();
    if (returnFocus === 'main') main.current?.focus();
  }, []);

  // While a slide is in progress no text is selected and no long press menu opens.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const guard = (event: Event) => {
      if (press.current) event.preventDefault();
    };
    el.addEventListener('selectstart', guard);
    return () => el.removeEventListener('selectstart', guard);
  }, []);

  // Choosing a page from the list closes it with the page; the help panel takes focus when it opens.
  useEffect(() => {
    if (open && view === 'help')
      help.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, view]);

  const rowAt = useCallback((y: number) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[data-pocket-row]') ?? [])];
    let found = -1;
    items.forEach((item, index) => {
      const box = item.getBoundingClientRect();
      if (y >= box.top - hitSlack && y <= box.bottom + hitSlack) found = index;
    });
    return found;
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLAnchorElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    press.current = { y: event.clientY, slid: false, hot: -1 };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A browser that cannot capture still gets the tap and the More button.
    }
  }
  function onPointerMove(event: ReactPointerEvent<HTMLAnchorElement>) {
    const current = press.current;
    if (!current) return;
    if (!current.slid && current.y - event.clientY > slideThreshold) {
      current.slid = true;
      setView('list');
      setOpen(true);
    }
    if (current.slid) {
      current.hot = rowAt(event.clientY);
      setHot(current.hot);
    }
  }
  function onPointerUp(event: ReactPointerEvent<HTMLAnchorElement>) {
    const current = press.current;
    press.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    if (!current?.slid) return;
    // A slide never runs the Next Move: the click that follows the release is cancelled.
    suppressUntil.current = performance.now() + 400;
    const chosen = list.current?.querySelectorAll<HTMLElement>('[data-pocket-row]')[current.hot];
    setHot(-1);
    if (chosen) chosen.click();
    else close(null);
  }
  function onPointerCancel() {
    press.current = null;
    close(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close('more');
    } else if (
      event.key === 'Tab' &&
      open &&
      !event.shiftKey &&
      document.activeElement === main.current
    ) {
      // The button is the last stop of the group: tabbing on leaves it, so the list goes too.
      close(null);
    }
  }
  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Tabbing out of the button, the list and the help panel closes the list. A press with no focus target (Safari does
    // not focus a tapped link) is the scrim's to handle, so the list is never torn down under a tap.
    const next = event.relatedTarget as Node | null;
    if (open && next && !event.currentTarget.contains(next)) close(null);
  }

  const hidden = (scrolledAway || atEnd) && !open;
  return (
    <div
      ref={root}
      className="ux-pocket"
      data-hidden={hidden ? 'true' : undefined}
      data-open={open ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      {open ? (
        <div className="ux-pocket-scrim" aria-hidden="true" onClick={() => close(null)} />
      ) : null}
      {open ? (
        view === 'list' ? (
          <div className="ux-pocket-panel" id={listId} role="group" aria-label="Quick Actions">
            <p className="ux-pocket-why">{move.reason}</p>
            <ul ref={list} className="ux-pocket-list">
              {rows.map((row, index) => (
                <li key={row.key}>
                  {row.href ? (
                    <Link
                      prefetch={false}
                      href={row.href}
                      className="ux-pocket-row"
                      data-pocket-row=""
                      data-hot={hot === index ? 'true' : undefined}
                      onClick={() => close(null)}
                    >
                      <CorridraIcon name={row.icon} />
                      <span>{row.label}</span>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="ux-pocket-row"
                      data-pocket-row=""
                      data-hot={hot === index ? 'true' : undefined}
                      onClick={row.run}
                    >
                      <CorridraIcon name={row.icon} />
                      <span>{row.label}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div
            className="ux-pocket-panel ux-pocket-help"
            id={listId}
            ref={help}
            role="menu"
            aria-label="Get Help"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest('a[href], [data-menu-close]')) close(null);
            }}
            onKeyDown={(event) => {
              const items = [
                ...(help.current?.querySelectorAll<HTMLElement>(
                  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]',
                ) ?? []),
              ].filter((item) => item.offsetParent !== null);
              const at = items.indexOf(document.activeElement as HTMLElement);
              const go = (to: number) => {
                event.preventDefault();
                items[(to + items.length) % items.length]?.focus();
              };
              if (event.key === 'ArrowDown') go(at + 1);
              else if (event.key === 'ArrowUp') go(at - 1);
              else if (event.key === 'Home') go(0);
              else if (event.key === 'End') go(items.length - 1);
            }}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="ux-menu-row ux-pocket-back"
              onClick={() => {
                setView('list');
                requestAnimationFrame(() =>
                  list.current?.querySelector<HTMLElement>('[data-pocket-row]')?.focus(),
                );
              }}
            >
              Back
            </button>
            {helpGroups.map((group) => (
              <div
                key={group.label}
                role="group"
                aria-label={group.label}
                className="ux-menu-group"
              >
                <p className="ux-menu-heading" aria-hidden="true">
                  {group.label}
                </p>
                {group.items.map((entry) => (
                  <Entry key={entry.label} entry={entry} listen={listen} />
                ))}
              </div>
            ))}
          </div>
        )
      ) : null}
      <div className="ux-pocket-dock">
        <button
          ref={more}
          type="button"
          className="ux-pocket-more"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => {
            if (open) close('more');
            else {
              setView('list');
              setOpen(true);
              requestAnimationFrame(() => {
                const rowsNow = list.current?.querySelectorAll<HTMLElement>('[data-pocket-row]');
                rowsNow?.[rowsNow.length - 1]?.focus();
              });
            }
          }}
        >
          <CorridraIcon name="more" />
          <span>More</span>
        </button>
        <Link
          ref={main}
          prefetch={false}
          href={move.href}
          className="ux-pocket-main"
          draggable={false}
          data-move={move.key}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            if (performance.now() < suppressUntil.current) {
              event.preventDefault();
              return;
            }
            close(null);
          }}
          onKeyDown={(event) => {
            // A link answers Enter; the button the person pressed also answers Space.
            if (event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
        >
          <CorridraIcon name={move.icon} />
          <span className="ux-pocket-label">{move.label}</span>
          {move.badge ? (
            <span className="ux-pocket-badge" aria-hidden="true">
              {move.badge}
            </span>
          ) : null}
          {move.badge ? <span className="sr-only">, {move.badge} waiting</span> : null}
        </Link>
      </div>
    </div>
  );
}
