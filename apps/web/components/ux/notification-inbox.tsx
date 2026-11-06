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
  onItems,
}: {
  endpoint: string;
  /** Called with each list the panel loads, so the bell can recount from it while the panel stays open (no extra request). */
  onItems?: (items: Item[]) => void;
  /** The customer panel: Needs You first, then Updates, then Earlier, with Mark All Read. Off: the plain list. */
  grouped?: boolean;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  // The latest callback, held in a ref so a new inline function from the parent never restarts the load.
  const itemsCallback = useRef(onItems);
  useEffect(() => {
    itemsCallback.current = onItems;
  });
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
        itemsCallback.current?.(list);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setItems(null);
        setError(e instanceof Error ? e.message : 'The inbox could not be loaded.');
      });
  }, [endpoint]);
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
  // Mark All Read uses the same single-item read each opened item uses, one after another, then reads the list again.
  async function markAllRead(list: Item[]) {
    setMarking(true);
    try {
      for (const item of list) {
        if (item.readAt) continue;
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id }),
        }).then((response) => readJson(response));
      }
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
  if (grouped) {
    const groups = items ? groupNotifications(items) : null;
    return (
      <section className="ux-kit-inbox ux-notice-panel" aria-labelledby="ux-inbox-title">
        <div className="ux-notice-head">
          <h2 id="ux-inbox-title" ref={heading} tabIndex={-1}>
            Notifications
          </h2>
          {groups && groups.unread > 0 ? (
            <button
              type="button"
              className="text-link"
              disabled={marking}
              onClick={() => void markAllRead(items ?? [])}
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
