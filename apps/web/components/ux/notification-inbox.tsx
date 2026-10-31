'use client';
// The in-app inbox for a signed-in shell (D7). Lists the person's own items from /api/notifications
// and marks one read when opened. Owner after Wave 0: WS-E.
import './ux-kit.css';
import { useCallback, useEffect, useState } from 'react';
import { formatDateTime } from '../../lib/ux/format';
import { readJson } from '../../lib/ux/step-up';
import { safeInternalPath } from '../../lib/ux/safe-path';

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

export function NotificationInbox({ tenant }: { tenant: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    fetch(`/api/notifications?tenant=${encodeURIComponent(tenant)}`)
      .then((r) => readJson<Item[]>(r))
      .then((list) => {
        setItems(list);
        setError('');
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'The inbox could not be loaded.'),
      );
  }, [tenant]);
  useEffect(() => {
    load();
  }, [load]);
  function markRead(item: Item) {
    if (item.readAt) return;
    void fetch(`/api/notifications?tenant=${encodeURIComponent(tenant)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
      keepalive: true,
    })
      .then(() => load())
      .catch(() => undefined);
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
