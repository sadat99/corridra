'use client';
// The in-app inbox for a signed-in shell (D7). Lists the person's own items from /api/notifications
// and marks one read when opened. Owner after Wave 0: WS-E.
import './ux-kit.css';
import './utility-menus.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../../lib/ux/format';
import { readJson } from '../../lib/ux/step-up';
import { safeInternalPath } from '../../lib/ux/safe-path';
import { groupNotifications } from '../../lib/ux/notification-groups';

type Item = {
  id: string;
  type: string;
  payload: { title?: string; href?: string };
  readAt: string | null;
  createdAt: string;
};

/** The customer inbox list returns the newest 30; a full list may hide older unread items. */
const listLimit = 30;

const typeTitle: Record<string, string> = {
  TEAM_INVITE: 'Team invitation',
  CONTRIBUTOR_INVITE: 'Contributor invitation',
  PARTICIPANT_INVITE: 'Programme invitation',
  TASK_ASSIGNED: 'Task assigned to you',
  QUOTE_SENT: 'New quote',
  QUOTE_ACCEPTED: 'Quote accepted',
  REPORT_PUBLISHED: 'New report ready',
  REQUEST_RECEIVED: 'Request received',
  REPLY_POSTED: 'New reply',
};

export function NotificationInbox({
  endpoint,
  grouped = false,
  onUnread,
}: {
  endpoint: string;
  /**
   * Called with the unread figure each time the panel loads, so the bell recounts while the panel stays open. It is
   * counted from the list; where the list is full (the page limit) the customer panel asks the server, because the
   * list is only the newest items.
   */
  onUnread?: (unread: number) => void;
  /** The customer panel: Needs You first, then Updates, then Earlier, with Mark All Read. Off: the plain list. */
  grouped?: boolean;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  // The latest callback, held in a ref so a new inline function from the parent never restarts the load.
  const unreadCallback = useRef(onUnread);
  useEffect(() => {
    unreadCallback.current = onUnread;
  });
  // The server's count of every unread item, known only where the list is full; otherwise null (the list is all of them).
  const [serverUnread, setServerUnread] = useState<number | null>(null);
  const load = useCallback(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then((r) => readJson<Item[]>(r))
      .then((list) => {
        if (controller.signal.aborted) return;
        setItems(list);
        setError('');
        const local = list.filter((item) => !item.readAt).length;
        unreadCallback.current?.(local);
        if (grouped && list.length >= listLimit) {
          // Only the newest items are loaded, so the true figure (and whether Mark All Read is needed) is the server's.
          fetch(`${endpoint}?count=1`, { cache: 'no-store', signal: controller.signal })
            .then((r) => readJson<{ unread: number }>(r))
            .then((body) => {
              if (controller.signal.aborted || typeof body.unread !== 'number') return;
              setServerUnread(body.unread);
              unreadCallback.current?.(body.unread);
            })
            .catch(() => undefined);
        } else setServerUnread(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setItems(null);
        setError(e instanceof Error ? e.message : 'The inbox could not be loaded.');
      });
  }, [endpoint, grouped]);
  useEffect(() => {
    load();
    function visibility() {
      active.current?.abort();
      if (document.visibilityState === 'hidden') {
        setItems(null);
        setError('');
      } else {
        load();
      }
    }
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active.current?.abort();
      active.current = null;
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [load]);
  function markRead(item: Item) {
    if (item.readAt) return;
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
      keepalive: true,
    })
      .then((response) => readJson(response))
      .then(() => {
        if (active.current && document.visibilityState === 'visible') load();
      })
      .catch((error: unknown) => {
        setItems(null);
        setError(error instanceof Error ? error.message : 'The inbox could not be updated.');
      });
  }
  const [marking, setMarking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  // In the grouped panel an item that is read moves to Earlier, which remounts its button. If that left focus on
  // the page, it goes back into the panel (its title), so Escape still closes the panel from where the person is.
  useEffect(() => {
    if (grouped && items && document.activeElement === document.body) heading.current?.focus();
  }, [grouped, items]);
  // Mark All Read is one server call that marks every unread item of the signed-in person (not only the ones loaded
  // here), then the list is read again. The server decides the recipient; nothing but {all:true} is sent.
  async function markAllRead() {
    setMarking(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const body = await readJson<{ unread?: number }>(response);
      if (typeof body.unread === 'number') unreadCallback.current?.(body.unread);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'The inbox could not be updated.');
    } finally {
      setMarking(false);
      load();
      // The button that was used goes away once nothing is unread, so focus stays in the panel, on its title.
      heading.current?.focus();
    }
  }
  function row(item: Item) {
    const title = item.payload.title ?? typeTitle[item.type] ?? 'Update';
    const target = safeInternalPath(item.payload.href);
    return (
      <li key={item.id} data-unread={!item.readAt}>
        {!item.readAt ? <span className="ux-notice-dot" aria-hidden="true" /> : null}
        {!item.readAt ? <span className="sr-only">Unread: </span> : null}
        {target ? (
          <a className="text-link" href={target} onClick={() => markRead(item)}>
            {title}
          </a>
        ) : (
          <button type="button" className="text-link" onClick={() => markRead(item)}>
            {title}
          </button>
        )}
        <span className="ux-kit-hint"> {formatDateTime(item.createdAt)}</span>
      </li>
    );
  }
  // A full list may hide older unread items. When the server's count could not be read the local figure is only a floor,
  // so Mark All Read stays available rather than hiding the way to clear them.
  const markAllAvailable = (localUnread: number) =>
    (serverUnread ?? localUnread) > 0 ||
    (serverUnread === null && (items?.length ?? 0) >= listLimit);
  if (grouped) {
    const groups = items ? groupNotifications(items) : null;
    return (
      <section className="ux-kit-inbox ux-notice-panel" aria-labelledby="ux-inbox-title">
        <div className="ux-notice-head">
          <h2 id="ux-inbox-title" ref={heading} tabIndex={-1}>
            Notifications
          </h2>
          {groups && markAllAvailable(groups.unread) ? (
            <button
              type="button"
              className="text-link"
              disabled={marking}
              onClick={() => void markAllRead()}
            >
              Mark All Read
            </button>
          ) : null}
        </div>
        {error ? (
          <p className="ux-kit-error" role="alert">
            {error}
          </p>
        ) : null}
        {items === null && !error ? <p className="ux-kit-hint">Loading…</p> : null}
        {items?.length === 0 ? <p className="ux-kit-hint">Nothing new.</p> : null}
        {groups
          ? (
              [
                ['Needs You', groups.needsYou],
                ['Updates', groups.updates],
                ['Earlier', groups.earlier],
              ] as const
            ).map(([name, list]) =>
              list.length ? (
                <div key={name} role="group" aria-label={name}>
                  <h3>{name}</h3>
                  <ul>{list.map(row)}</ul>
                </div>
              ) : null,
            )
          : null}
      </section>
    );
  }
  return (
    <section className="ux-kit-inbox" aria-labelledby="ux-inbox-title">
      <h2 id="ux-inbox-title">Inbox</h2>
      {error ? (
        <p className="ux-kit-error" role="alert">
          {error}
        </p>
      ) : null}
      {items === null && !error ? <p className="ux-kit-hint">Loading…</p> : null}
      {items?.length === 0 ? <p className="ux-kit-hint">Nothing new.</p> : null}
      {items?.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.id} data-unread={!item.readAt}>
              {(() => {
                const title = item.payload.title ?? typeTitle[item.type] ?? 'Update';
                const target = safeInternalPath(item.payload.href);
                return target ? (
                  <a className="text-link" href={target} onClick={() => markRead(item)}>
                    {title}
                  </a>
                ) : (
                  <button type="button" className="text-link" onClick={() => markRead(item)}>
                    {title}
                  </button>
                );
              })()}
              <span className="ux-kit-hint"> {formatDateTime(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
