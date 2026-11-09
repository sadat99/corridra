'use client';
// Pieces the signed-in headers share: the workspaces read, the inbox bell with its unread count, and the
// language choices. The customer header row itself is in customer-header.tsx. They read only what the
// signed-in header already reads; nothing here decides access, and every page and action still checks on
// the server.
import './customer-bar.css';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CorridraIcon } from '../corridra-icon';
import { useLanguage } from '../language-provider';
import { localeMeta } from '../../lib/i18n/locales';
import { NotificationInbox } from './notification-inbox';
import { MenuRadio } from './overflow-menu';

export type Workspace = { id: string; name: string };
type Item = { readAt: string | null };

/** Read only on the customer account pages, where New request and the switcher need them. */
export function useWorkspaces(active: boolean) {
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

/**
 * The inbox as an icon with its unread count. `counted`: read the unread count in the background. The list
 * itself loads when it is opened. `endpoint` is the person's own inbox read (the customer inbox, or the team
 * notifications of the workspace in view); `label` is the button's accessible name.
 */
export function BarInbox({
  counted,
  endpoint,
  label = 'Inbox',
  grouped = false,
}: {
  counted: boolean;
  endpoint: string;
  label?: string;
  /** The customer panel (Needs You, Updates, Earlier, Mark All Read) instead of the plain list. */
  grouped?: boolean;
}) {
  const [unread, setUnread] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const panelId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-inbox`;
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const load = useCallback(
    (signal?: AbortSignal) => {
      fetch(endpoint, { cache: 'no-store', signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((items: Item[] | null) => {
          if (signal?.aborted) return;
          setUnread(Array.isArray(items) ? items.filter((i) => !i.readAt).length : null);
          // The customer list holds only the newest 30. A full list may hide older unread items, so the figure on
          // the bell is then the server's own count over every item.
          if (grouped && Array.isArray(items) && items.length >= 30)
            fetch(`${endpoint}?count=1`, { cache: 'no-store', signal })
              .then((r) => (r.ok ? r.json() : null))
              .then((body: { unread?: unknown } | null) => {
                if (!signal?.aborted && typeof body?.unread === 'number') setUnread(body.unread);
              })
              .catch(() => undefined);
        })
        .catch(() => {
          if (!signal?.aborted) setUnread(null);
        });
    },
    [endpoint, grouped],
  );
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
        aria-label={label}
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
        {open ? (
          <NotificationInbox endpoint={endpoint} grouped={grouped} onUnread={setUnread} />
        ) : null}
      </div>
    </div>
  );
}

/** The language choices of an account menu, shown only when more than one language is offered. */
export function LanguageMenuGroup() {
  const { locale, offered, choose, t } = useLanguage();
  if (offered.length < 2) return null;
  return (
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
  );
}
