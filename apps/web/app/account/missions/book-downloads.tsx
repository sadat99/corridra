'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { fill, fillNodes } from '../../../lib/i18n/fill';
import { translate, type MessageKey } from '../../../lib/i18n/messages';
import { formatDate } from '../../../lib/ux/format';
import { savedMissionHeaders } from '../saved-missions';
import './book-downloads.css';

export type BookKind = 'TRIP' | 'SUPPLIER';
/**
 * The command id of each kind of download that was started and not finished. The parent holds it, so it survives
 * this panel being removed and mounted again; it is forgotten on success, a refusal or a denial, never on a failure
 * that leaves it unknown whether the file was made.
 */
export type PendingBooks = {
  /** The id for this kind, made on the first press and the same on every retry. */
  ensure: (kind: BookKind) => string;
  forget: (kind: BookKind) => void;
  clear: () => void;
  any: () => boolean;
};
export function createPendingBooks(): PendingBooks {
  const ids = new Map<BookKind, string>();
  return {
    ensure: (kind) => {
      const known = ids.get(kind);
      if (known) return known;
      const made = crypto.randomUUID();
      ids.set(kind, made);
      return made;
    },
    forget: (kind) => void ids.delete(kind),
    clear: () => ids.clear(),
    any: () => ids.size > 0,
  };
}
type Message = { tone: 'status' | 'alert'; text: ReactNode };

// The panel sits in the page's English frame, so its fixed words are the English words.
const say = (key: MessageKey) => translate('en', key);
const names: Record<BookKind, { name: MessageKey; label: MessageKey; empty: MessageKey }> = {
  TRIP: { name: 'books.name.trip', label: 'books.download.trip', empty: 'books.empty.trip' },
  SUPPLIER: {
    name: 'books.name.supplier',
    label: 'books.download.supplier',
    empty: 'books.empty.supplier',
  },
};
const kinds: BookKind[] = ['TRIP', 'SUPPLIER'];
const waitLimitMs = 60_000;
const revokeAfterMs = 1_000;

function count(n: number, one: MessageKey, other: MessageKey) {
  return n === 0 ? say('books.count.none') : n === 1 ? say(one) : fill(say(other), { n });
}
/** "3 Nov 2026, 14:05 UTC": the time zone is always shown. */
function createdAt(iso: string) {
  const date = new Date(iso);
  return `${formatDate(date, { timeZone: 'UTC' })}, ${date.toISOString().slice(11, 16)} UTC`;
}
/** The first sentence is the one that must be seen, so it is the bold one. */
function Notice({ id }: { id: string }) {
  const text = say('books.notice');
  const cut = text.indexOf('. ') + 1;
  return (
    <p id={id}>
      {cut > 0 ? (
        <>
          <strong>{text.slice(0, cut)}</strong> {text.slice(cut + 1)}
        </>
      ) : (
        <strong>{text}</strong>
      )}
    </p>
  );
}

/**
 * Two downloads of the saved mission page: the Trip Book and the Supplier Book, each a PDF made on the server from
 * what the Corridra team has reviewed (ADR-076). Pressing a button is the person's acknowledgement that a file
 * cannot be recalled, which the notice above the buttons says. A download that could not be confirmed is retried
 * with the same command id, so it never makes a second record; the ids live in the parent (`pending`).
 */
export function BookDownloads({
  subject,
  issuer,
  resourceId,
  tripCount,
  supplierCount,
  pending,
  onDenied,
  onChanged,
}: {
  subject: string;
  issuer: string;
  resourceId: string;
  tripCount: number;
  supplierCount: number;
  pending: PendingBooks;
  /** Access is gone (401 or 403): the parent clears the report and says so. */
  onDenied: (message: string, signedOut: boolean) => void;
  /** The reviewed content changed: the parent reads the report again without closing this panel. */
  onChanged: () => void;
}) {
  const noticeId = useId();
  const emptyId = useId();
  const [busy, setBusy] = useState<BookKind | null>(null);
  const [message, setMessage] = useState<Message | null>(() =>
    pending.any() ? { tone: 'alert', text: say('books.retry') } : null,
  );
  const inFlight = useRef(false);
  const task = useRef<AbortController | null>(null);
  const counts: Record<BookKind, number> = { TRIP: tripCount, SUPPLIER: supplierCount };

  // Leaving the page or hiding it stops a download that is still running; its id stays for the next try.
  useEffect(() => () => task.current?.abort(), []);

  async function download(kind: BookKind) {
    if (inFlight.current || counts[kind] === 0) return;
    inFlight.current = true;
    const book = say(names[kind].name);
    const commandId = pending.ensure(kind);
    const controller = new AbortController();
    task.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, waitLimitMs);
    setBusy(kind);
    setMessage({ tone: 'status', text: fill(say('books.busy'), { book }) });
    const finish = (next: Message | null) => {
      if (!controller.signal.aborted || timedOut) setMessage(next);
    };
    const forget = () => pending.forget(kind);
    try {
      const response = await fetch('/api/customer-books', {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: savedMissionHeaders({ subject, issuer }),
        body: JSON.stringify({ resourceId, commandId, kind, acknowledged: true }),
      });
      if (response.ok) {
        const code = response.headers.get('X-Corridra-Book-Digest') ?? '';
        const made = response.headers.get('X-Corridra-Book-Generated-At') ?? '';
        const pdf = response.headers.get('Content-Type')?.startsWith('application/pdf') ?? false;
        // Anything but a PDF with its content code and time is not a confirmed download; keep the id and say so.
        if (!pdf || !/^[a-f0-9]{64}$/.test(code) || !Number.isFinite(Date.parse(made)))
          throw new Error('unconfirmed');
        const blob = await response.blob();
        if (blob.size === 0) throw new Error('unconfirmed');
        if (controller.signal.aborted) throw new Error('unconfirmed');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `corridra-${kind.toLowerCase()}-book-${new Date(made).toISOString().slice(0, 10).replaceAll('-', '')}.pdf`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs);
        forget();
        finish({
          tone: 'status',
          text: (
            <>
              {fill(say('books.success'), { book })}{' '}
              {fillNodes(say('books.success.detail'), {
                time: createdAt(made),
                code: <code>{code.slice(0, 16)}</code>,
              })}
            </>
          ),
        });
        return;
      }
      if (response.status === 401 || response.status === 403) {
        forget();
        pending.clear();
        onDenied(
          say(response.status === 401 ? 'books.signedOut' : 'books.denied'),
          response.status === 401,
        );
        return;
      }
      if (response.status === 409) {
        forget();
        finish({ tone: 'alert', text: say('books.changed') });
        onChanged();
        return;
      }
      if (response.status === 429) {
        forget();
        finish({ tone: 'alert', text: say('books.tooMany') });
        return;
      }
      if (response.status === 503 || response.status === 404) {
        forget();
        finish({ tone: 'alert', text: say('books.unavailable') });
        return;
      }
      if (response.status === 422) {
        const reason = ((await response.json().catch(() => null)) as { reason?: unknown } | null)
          ?.reason;
        if (reason === 'UNSUPPORTED_TEXT') {
          forget();
          finish({ tone: 'alert', text: say('books.unsupported') });
          return;
        }
        if (reason === 'EMPTY') {
          forget();
          finish({ tone: 'alert', text: say('books.emptyStale') });
          onChanged();
          return;
        }
      }
      throw new Error('unconfirmed');
    } catch {
      // A network error, a time-out, a server error or a reply that is not the file: it may or may not have been
      // recorded, so the same command id is kept and the next press is a retry, not a second download.
      finish({ tone: 'alert', text: say('books.retry') });
    } finally {
      clearTimeout(timer);
      inFlight.current = false;
      if (!controller.signal.aborted || timedOut) setBusy(null);
    }
  }

  return (
    <details className="ux-mission-detail book-downloads">
      <summary>
        <h2>{say('books.heading')}</h2>
      </summary>
      <div className="book-downloads-body">
        <p>{say('books.intro')}</p>
        <p>
          {fill(say('books.count.line'), {
            trip: count(tripCount, 'books.count.trip.one', 'books.count.trip.other'),
            supplier: count(
              supplierCount,
              'books.count.supplier.one',
              'books.count.supplier.other',
            ),
          })}
        </p>
        <Notice id={noticeId} />
        <div className="guide-actions-row">
          {kinds.map((kind) => {
            const empty = counts[kind] === 0;
            const working = busy === kind;
            return (
              <button
                key={kind}
                type="button"
                className="text-link"
                disabled={empty || (busy !== null && !working)}
                aria-disabled={working ? true : undefined}
                aria-busy={working ? true : undefined}
                aria-describedby={empty ? `${noticeId} ${emptyId}-${kind}` : noticeId}
                onClick={() => void download(kind)}
              >
                {say(names[kind].label)}
              </button>
            );
          })}
        </div>
        {kinds
          .filter((kind) => counts[kind] === 0)
          .map((kind) => (
            <p key={kind} id={`${emptyId}-${kind}`}>
              {say(names[kind].empty)}
            </p>
          ))}
        <p role="status">{message?.tone === 'status' ? message.text : ''}</p>
        {message?.tone === 'alert' && <p role="alert">{message.text}</p>}
      </div>
    </details>
  );
}
