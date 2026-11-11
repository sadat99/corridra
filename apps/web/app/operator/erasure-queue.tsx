'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { displayDate } from '@corridra/domain/locale';
import { Dialog } from '../../components/ux/dialog';
import '../../components/problem-reports/problem-reports.css';
import {
  queueFailure,
  removalOnRequest,
  removalWordsUnderRequest,
  removeWordsUnderRequest,
  wordsRemovedMessage,
} from '../../lib/problem-report-queue';

// Staff queue of customer erasure requests (CRUD G5). It shows a reference, a state, the due date and whether the
// closed account can still be undone, and nothing else about the person. There is no scope control: the database
// decides sample or real from this staff workspace.
const statusValues = ['received', 'in_progress', 'completed', 'declined'] as const;
type Status = (typeof statusValues)[number];
const queueSchema = z
  .object({
    nextAfter: z.number().int().nullable(),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            number: z.number().int(),
            reference: z.string(),
            filedAt: z.iso.datetime({ offset: true }),
            dueAt: z.iso.datetime({ offset: true }),
            daysLeft: z.number().int(),
            status: z.enum(statusValues),
            note: z.string().nullable(),
            accountStatus: z.enum(['active', 'closed', 'final']),
            closedAt: z.iso.datetime({ offset: true }).nullable(),
            undoUntil: z.iso.datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
type Queue = z.infer<typeof queueSchema>;
type Item = Queue['items'][number];
type ToState = 'in_progress' | 'completed' | 'declined';
type Pending = { item: Item; toState: ToState; commandId: string };

const statusLabel: Record<Status, string> = {
  received: 'Received',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
};
const actionLabel: Record<ToState, string> = {
  in_progress: 'Start Work',
  completed: 'Complete',
  declined: 'Decline',
};
const allowed: Record<Status, ToState[]> = {
  received: ['in_progress', 'declined'],
  in_progress: ['completed', 'declined'],
  completed: [],
  declined: [],
};

export function accountText(item: Pick<Item, 'accountStatus' | 'undoUntil'>) {
  if (item.accountStatus === 'final') return 'Closed, final';
  if (item.accountStatus === 'closed')
    return item.undoUntil
      ? 'Closed, can be undone until ' + displayDate(item.undoUntil)
      : 'Closed, can be undone';
  return 'Account still open';
}
export function dueText(item: Pick<Item, 'status' | 'daysLeft' | 'dueAt'>) {
  if (item.status === 'completed' || item.status === 'declined') return 'Answered';
  if (item.daysLeft < 0)
    return (
      'Overdue by ' +
      -item.daysLeft +
      (item.daysLeft === -1 ? ' day' : ' days') +
      ', was due ' +
      displayDate(item.dueAt)
    );
  return (
    'Due ' +
    displayDate(item.dueAt) +
    ', ' +
    item.daysLeft +
    (item.daysLeft === 1 ? ' day' : ' days') +
    ' left'
  );
}
// The database refuses a note with any control character (a line break, a tab). Same rule as the route; a test keeps
// them equal.
const controlCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
export const noteProblemText =
  'Notes must be on one line, with no line breaks, tabs or control characters';
export function noteProblem(note: string) {
  return controlCharacters.test(note.trim()) ? noteProblemText : null;
}
// What the page says after a move. A reload that failed must not be hidden by the success: both are said, and the
// caller clears the list because it would still show the old state of the request.
export function movedMessage(reference: string, reloadFailure: string | null) {
  return reloadFailure === null
    ? 'Request ' + reference + ' moved.'
    : 'Request ' + reference + ' moved, but the list could not be reloaded. ' + reloadFailure;
}
function failureText(status: number) {
  if (status === 401 || status === 403)
    return 'Your sign-in or authenticator check is not current, or this role cannot manage requests. Check it and try again.';
  if (status === 409) return 'That request changed or is not in this queue. Reload the list.';
  if (status === 503) return 'The erasure queue is not available yet.';
  return 'The request could not be completed. Please try again.';
}

type Props = {
  tenant: string;
  role?: string;
  /** Whether Report a Problem is offered: only then is the owner's word removal drawn. Missing means not offered. */
  problemReports?: boolean;
};
export function ErasureQueue(props: Props) {
  return <Queue key={props.tenant} {...props} />;
}
function Queue({ tenant, role, problemReports = false }: Props) {
  const [queue, setQueue] = useState<Queue | null>(null),
    [filter, setFilter] = useState<Status | ''>(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Pending | null>(null),
    [note, setNote] = useState(''),
    [removing, setRemoving] = useState<Item | null>(null),
    [removalBusy, setRemovalBusy] = useState(false),
    [removalFailure, setRemovalFailure] = useState(''),
    [removalResult, setRemovalResult] = useState('');
  // One command id per request, kept until the removal is confirmed, so a retry of an answer that did not arrive is the
  // same command and never removes twice.
  const removalCommands = useRef(new Map<string, string>());
  const controller = useRef<AbortController | null>(null);
  const endpoint = '/api/workspace/customer-erasure-queue?tenant=' + encodeURIComponent(tenant);
  useEffect(() => () => controller.current?.abort(), []);

  // `moved` is the reference of a request that was just moved. If this reload fails, the message says both things and
  // the list is cleared, because the list on screen would still show the old state of that request.
  async function load(after?: number, moved?: string) {
    if (busy && !moved) return;
    controller.current?.abort();
    const task = new AbortController();
    controller.current = task;
    setBusy(true);
    setMessage('');
    setPending(null);
    try {
      const r = await fetch(
        endpoint +
          (filter ? '&status=' + filter : '') +
          (after === undefined ? '' : '&after=' + after),
        { cache: 'no-store', signal: task.signal },
      );
      if (!r.ok) throw Error(failureText(r.status));
      const v = queueSchema.parse(await r.json());
      if (task.signal.aborted) return;
      setQueue(after === undefined || !queue ? v : { ...v, items: [...queue.items, ...v.items] });
      if (moved) setMessage(movedMessage(moved, null));
      else if (v.items.length === 0 && after === undefined)
        setMessage('No erasure requests to show.');
    } catch (e) {
      if (!task.signal.aborted) {
        const reason = e instanceof Error ? e.message : 'The list could not be loaded.';
        if (moved) {
          setQueue(null);
          setMessage(movedMessage(moved, reason));
        } else setMessage(reason);
      }
    } finally {
      if (!task.signal.aborted) setBusy(false);
    }
  }
  function choose(item: Item, toState: ToState) {
    setNote('');
    setMessage('');
    setPending({ item, toState, commandId: crypto.randomUUID() });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!pending || busy) return;
    const needsNote = pending.toState !== 'in_progress';
    const text = note.trim();
    if (needsNote && (text.length < 10 || text.length > 1000)) {
      setMessage('Write 10 to 1000 characters about what was kept and why.');
      return;
    }
    const problem = needsNote ? noteProblem(text) : null;
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          commandId: pending.commandId,
          requestId: pending.item.id,
          expectedState: pending.item.status,
          toState: pending.toState,
          ...(needsNote ? { note: text } : {}),
        }),
      });
      if (!r.ok) throw Error(failureText(r.status));
      const reference = pending.item.reference;
      setPending(null);
      setNote('');
      await load(undefined, reference);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'The request could not be completed.');
      setBusy(false);
    }
  }

  // Owner only (members.manage): the server refuses anyone else, so the control is not drawn for them. The count in the
  // result is the one in the answer; nothing is counted before the person confirms.
  async function removeWords() {
    if (!removing || removalBusy) return;
    const id = removing.id;
    const commandId = removalCommands.current.get(id) ?? crypto.randomUUID();
    removalCommands.current.set(id, commandId);
    setRemovalBusy(true);
    setRemovalFailure('');
    try {
      const done = await removeWordsUnderRequest(tenant, commandId, id);
      removalCommands.current.delete(id);
      setRemoving(null);
      setRemovalResult(wordsRemovedMessage(done.removed));
    } catch (e) {
      setRemovalFailure(queueFailure(e, 'remove').message);
    } finally {
      setRemovalBusy(false);
    }
  }

  return (
    <section aria-labelledby="erasure-queue-title" className="ux-panel">
      <h2 id="erasure-queue-title">Erasure Requests</h2>
      <p>
        People who closed their account can ask for their data to be erased. Each request needs an
        answer within the date shown. Invoices, signed decisions and audit rows are kept as the
        record requires, and the note you write is what the person reads.
      </p>
      <label>
        Show
        <select
          value={filter}
          disabled={busy}
          onChange={(e) => {
            controller.current?.abort();
            setFilter(e.target.value as Status | '');
            setQueue(null);
            setPending(null);
            setBusy(false);
            setMessage('Choose Load Erasure Requests to show this selection.');
          }}
        >
          <option value="">All requests</option>
          {statusValues.map((s) => (
            <option key={s} value={s}>
              {statusLabel[s]}
            </option>
          ))}
        </select>
      </label>
      <button className="text-link" type="button" disabled={busy} onClick={() => void load()}>
        Load Erasure Requests
      </button>
      {message && <p role="status">{message}</p>}
      {queue && queue.items.length > 0 && (
        <ul>
          {queue.items.map((i) => (
            <li key={i.id}>
              <strong>{i.reference}</strong> · {statusLabel[i.status]} · {dueText(i)} ·{' '}
              {accountText(i)} · filed {displayDate(i.filedAt)}
              {i.note ? ' · Note: ' + i.note : ''}{' '}
              {allowed[i.status].map((to) => (
                <button
                  key={to}
                  className="text-link"
                  type="button"
                  disabled={busy}
                  aria-label={actionLabel[to] + ' ' + i.reference}
                  onClick={() => choose(i, to)}
                >
                  {actionLabel[to]}
                </button>
              ))}
              {removalOnRequest(role, problemReports, i.status) && (
                <button
                  className="text-link"
                  type="button"
                  disabled={busy || removalBusy}
                  aria-label={removalWordsUnderRequest.button + ' ' + i.reference}
                  onClick={() => {
                    setRemovalFailure('');
                    setRemovalResult('');
                    setRemoving(i);
                  }}
                >
                  {removalWordsUnderRequest.button}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="pr-status">
        {removalResult}
      </p>
      {queue?.nextAfter !== null && queue?.nextAfter !== undefined && (
        <button
          className="text-link"
          type="button"
          disabled={busy}
          onClick={() => void load(queue.nextAfter!)}
        >
          Show More Requests
        </button>
      )}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removalWordsUnderRequest.title}
        locked={removalBusy}
      >
        <p>{removalWordsUnderRequest.body}</p>
        {removing && (
          <p>
            <strong>{removing.reference}</strong>
          </p>
        )}
        {removalFailure && <p role="alert">{removalFailure}</p>}
        <div className="ux-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            data-autofocus=""
            disabled={removalBusy}
            onClick={() => setRemoving(null)}
          >
            {removalWordsUnderRequest.keep}
          </button>
          <button
            type="button"
            className="primary-link"
            disabled={removalBusy}
            onClick={() => void removeWords()}
          >
            {removalBusy ? 'Please Wait…' : removalWordsUnderRequest.confirm}
          </button>
        </div>
      </Dialog>
      {pending && (
        <form onSubmit={(e) => void submit(e)} aria-label={'Answer ' + pending.item.reference}>
          <h3>
            {actionLabel[pending.toState]}: {pending.item.reference}
          </h3>
          {pending.toState !== 'in_progress' && (
            <label>
              Note to the person
              <span> (10 to 1000 characters, on one line, no line breaks or tabs)</span>
              <textarea
                value={note}
                maxLength={1000}
                rows={4}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <button type="submit" disabled={busy}>
            Confirm
          </button>{' '}
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
