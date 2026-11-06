'use client';
import { useRef, useState } from 'react';
import type { MailMute } from '@corridra/auth/customer-notifications';
import { Dialog } from '../../../components/ux/dialog';
import { limitWords, notReachedWords } from '../../../lib/account-limit';
import './muted-requests.css';

// The requests a person stopped emails about, with a way back. Stopping came from the Mute link in an email;
// this is where it is undone. Turning emails on again asks first and says what it does and does not send.
const kindWords: Record<MailMute['store'], string> = {
  request: 'Receipt and progress emails',
  reminder: 'Reminder emails',
};

export function MutedRequests({
  initial,
  titles,
  subject,
  issuer,
}: {
  initial: MailMute[];
  titles: Record<string, string>;
  subject: string;
  issuer: string;
}) {
  const [items, setItems] = useState(initial);
  const [asking, setAsking] = useState<MailMute | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ key: string; text: string } | null>(null);
  // One command id per decision, so a lost answer is retried as the same request.
  const commands = useRef(new Map<string, string>());
  const key = (item: Pick<MailMute, 'store' | 'requestId'>) => `${item.store}:${item.requestId}`;
  const title = (id: string) => titles[id] ?? 'A request you sent';

  async function change(item: MailMute, muted: boolean) {
    if (busy) return;
    if (typeof crypto.randomUUID !== 'function') {
      setMessage({ key: key(item), text: 'Use a current browser to change this securely.' });
      return;
    }
    const decision = `${key(item)}:${muted}`;
    const commandId = commands.current.get(decision) ?? crypto.randomUUID();
    commands.current.set(decision, commandId);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch('/api/pulse/mutes', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'x-corridra-customer-subject': subject,
          'x-corridra-customer-issuer': issuer,
        },
        body: JSON.stringify({ store: item.store, requestId: item.requestId, commandId, muted }),
      });
      const data: { muted?: unknown; reason?: unknown } | null = await response
        .json()
        .catch(() => null);
      if (!response.ok || typeof data?.muted !== 'boolean') {
        setMessage({
          key: key(item),
          text:
            response.status === 429
              ? limitWords
              : response.status === 403
                ? 'This request is not available to change.'
                : response.status === 503
                  ? 'Email choices are unavailable right now.'
                  : 'The change was not confirmed. Try the same request again.',
        });
        return;
      }
      if (data.reason === 'closed') {
        setMessage({ key: key(item), text: 'Emails cannot be turned on right now.' });
        setAsking(null);
        return;
      }
      commands.current.delete(decision);
      setItems((all) =>
        all.map((one) => (key(one) === key(item) ? { ...one, muted: data.muted as boolean } : one)),
      );
      setMessage({
        key: key(item),
        text: data.muted
          ? 'Emails about this request are stopped.'
          : 'Emails about this request are on again.',
      });
      setAsking(null);
    } catch {
      setMessage({ key: key(item), text: notReachedWords });
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return null;
  return (
    <section className="muted-requests" aria-labelledby="muted-requests-heading">
      <h2 id="muted-requests-heading">Requests you muted</h2>
      <p className="notifications-help">
        You stopped emails about these from the Mute link in an email. Starting them again sends
        nothing from the time they were stopped.
      </p>
      <ul>
        {items.map((item) => (
          <li key={key(item)}>
            <span>
              <strong>{title(item.requestId)}</strong>
              <span>
                {kindWords[item.store]}: {item.muted ? 'stopped' : 'on again'}
              </span>
            </span>
            {item.muted ? (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => setAsking(item)}
              >
                Unmute
              </button>
            ) : (
              <button
                type="button"
                className="button button-secondary"
                disabled={busy}
                onClick={() => void change(item, true)}
              >
                Mute Again
              </button>
            )}
            {message?.key === key(item) && <p role="status">{message.text}</p>}
          </li>
        ))}
      </ul>
      <Dialog
        open={!!asking}
        onClose={() => setAsking(null)}
        title="Start Emails Again?"
        locked={busy && !!asking}
      >
        {asking && (
          <>
            <p>
              We will send {kindWords[asking.store].toLowerCase()} about {title(asking.requestId)}{' '}
              again, only for things that happen from now on. Nothing from the time you stopped them
              is sent. You can mute them again at any time.
            </p>
            <div className="ux-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                data-autofocus=""
                disabled={busy}
                onClick={() => setAsking(null)}
              >
                Keep Them Stopped
              </button>
              <button
                type="button"
                className="primary-link"
                disabled={busy}
                onClick={() => void change(asking, false)}
              >
                {busy ? 'Please Wait…' : 'Start Emails Again'}
              </button>
            </div>
            {message?.key === key(asking) && <p role="alert">{message.text}</p>}
          </>
        )}
      </Dialog>
    </section>
  );
}
