'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { problemReportLimits, problemReportStatuses } from '@corridra/domain/problem-report';
import type {
  ProblemReportQueue as Queue,
  ProblemReportQueueItem as Item,
} from '@corridra/auth/problem-reports';
import '../../components/problem-reports/problem-reports.css';
import { whenWords } from '../account/workspace-lifecycle-client';
import { ModeLabel } from '../../components/mr/mode-label';
import { ReportFailure } from '../../components/problem-reports/failure-line';
import { SegmentedFilter, type SegmentOption } from '../../components/ux/segmented-filter';
import { teamReportLinks } from '../../lib/problem-report-links';
import {
  canTriage,
  moveReport,
  movesFrom,
  noteProblem,
  oldestWaitingLine,
  problemReportQueueFragment as fragment,
  queueFailure,
  queueTotal,
  queueWords,
  readQueue,
  reporterKindLabels,
  type Move,
  type QueueFailure,
  type QueueFilter,
} from '../../lib/problem-report-queue';
import { categoryWords, statusLabels } from '../../lib/problem-report-words';

// The triage queue of problem reports (spec section 6, ADR-078). Owners and admins read the queue and move a report along;
// the server and the database decide who may and which move is allowed. The note stays in this page's memory until the
// move is saved, whatever fails on the way (a dropped connection, a stale report, a fresh authenticator check). One command
// id answers every retry of the same move.
type Pending = {
  item: Item;
  move: Move;
  commandId: string;
};
type Message = { tone: 'status' | 'alert'; text: string };

export function ProblemReportQueue({ tenant, role }: { tenant: string; role: string }) {
  // The workspace mounts this for owners and admins only; the role is checked here as well, so it can never draw for another.
  return canTriage(role) ? <QueuePanel key={tenant} tenant={tenant} /> : null;
}

function QueuePanel({ tenant }: { tenant: string }) {
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [queue, setQueue] = useState<Queue | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [loadFailure, setLoadFailure] = useState<QueueFailure | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moveFailure, setMoveFailure] = useState<QueueFailure | null>(null);
  // The note of a move that could not go on (the report changed under the person): offered again for that report.
  const kept = useRef<{ id: string; text: string } | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const run = useRef(0);
  const links = teamReportLinks(tenant);

  // The address #problem-report-queue opens the panel, and the workspace scrolls to it.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === `#${fragment}` && details.current) details.current.open = true;
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  /** Puts the open move in step with a fresh read: the same move when it still holds, otherwise its note is kept. */
  function reconcile(
    fresh: Item[],
    current: Pending | null,
  ): { pending: Pending | null; message: Message | null } {
    if (!current) return { pending: null, message: null };
    const item = fresh.find((candidate) => candidate.id === current.item.id);
    if (!item) {
      kept.current = { id: current.item.id, text: note };
      return { pending: null, message: { tone: 'alert', text: queueWords.gone } };
    }
    const move = movesFrom(item.status).find((candidate) => candidate.to === current.move.to);
    if (!move) {
      kept.current = { id: item.id, text: note };
      return { pending: null, message: { tone: 'alert', text: queueWords.movedOn(item.status) } };
    }
    // Another status means another move: a command id is for one move only, so the changed one gets its own.
    const same = item.status === current.item.status;
    return {
      pending: { item, move, commandId: same ? current.commandId : crypto.randomUUID() },
      message: null,
    };
  }

  /** Reads a page. `moved` is a move that was just saved: if this read fails, both things are said. */
  async function load(after: number | null, moved?: { reference: string; status: Item['status'] }) {
    if (busy && !moved) return;
    const token = ++run.current;
    setBusy(true);
    setLoadFailure(null);
    setMessage(null);
    try {
      const fresh = await readQueue(tenant, filter, after);
      if (token !== run.current) return;
      setQueue(fresh);
      const next = after === null ? fresh.items : [...items, ...fresh.items];
      setItems(next);
      if (after === null) {
        // A move that was just saved leaves nothing open; any other first page keeps the open move in step.
        const reconciled = moved
          ? { pending: null, message: null }
          : reconcile(fresh.items, pending);
        setPending(reconciled.pending);
        setMoveFailure(null);
        setMessage(
          moved
            ? { tone: 'status', text: queueWords.moved(moved.reference, moved.status) }
            : (reconciled.message ??
                (fresh.items.length === 0 ? { tone: 'status', text: queueWords.empty } : null)),
        );
      }
    } catch (error) {
      if (token !== run.current) return;
      const failure = queueFailure(error, 'load');
      if (moved) {
        // The list on screen would still show the old status, so it is cleared.
        setQueue(null);
        setItems([]);
        setPending(null);
        setMessage({
          tone: 'alert',
          text: queueWords.movedNotReloaded(moved.reference, moved.status, failure.message),
        });
      } else setLoadFailure(failure);
    } finally {
      if (token === run.current) setBusy(false);
    }
  }

  function choose(item: Item, move: Move) {
    setMessage(null);
    setNoteError(null);
    setMoveFailure(null);
    setNote(kept.current?.id === item.id ? kept.current.text : '');
    setPending({ item, move, commandId: crypto.randomUUID() });
  }

  function cancel() {
    kept.current = null;
    setPending(null);
    setNote('');
    setNoteError(null);
    setMoveFailure(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!pending || saving) return;
    const problem = noteProblem(note, pending.move.noteRequired);
    setNoteError(problem);
    if (problem) return;
    setSaving(true);
    setMoveFailure(null);
    try {
      const done = await moveReport(tenant, {
        commandId: pending.commandId,
        reportId: pending.item.id,
        expectedState: pending.item.status as 'received' | 'in_review',
        toState: pending.move.to,
        note,
      });
      kept.current = null;
      setPending(null);
      setNote('');
      setSaving(false);
      await load(null, { reference: done.reference, status: done.status });
    } catch (error) {
      setSaving(false);
      setMoveFailure(queueFailure(error, 'move'));
    }
  }

  const counts = queue?.counts;
  const options: SegmentOption<QueueFilter>[] = [
    { value: 'all', label: queueWords.filterAll, count: counts ? queueTotal(counts) : undefined },
    ...problemReportStatuses.map((status) => ({
      value: status,
      label: statusLabels[status],
      count: counts?.[status],
    })),
  ];

  return (
    <details ref={details} id={fragment} tabIndex={-1} className="receipt-disclosure ux-panel">
      <summary>
        <h2>{queueWords.title}</h2>
        {counts ? (
          <span className="pr-meta">{queueWords.waiting(counts.received, queueTotal(counts))}</span>
        ) : null}
      </summary>
      <div className="pr-queue">
        <p>{queueWords.intro}</p>
        <SegmentedFilter
          label={queueWords.filterLabel}
          value={filter}
          options={options}
          onChange={(value) => {
            run.current += 1;
            setFilter(value);
            setItems([]);
            setPending(null);
            kept.current = null;
            setBusy(false);
            setLoadFailure(null);
            setMessage({ tone: 'status', text: queueWords.chooseLoad });
          }}
        />
        <div className="pr-actions">
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => void load(null)}
          >
            {busy && items.length === 0 ? queueWords.loading : queueWords.load}
          </button>
        </div>
        {loadFailure ? (
          <ReportFailure
            failure={{ message: loadFailure.message, link: loadFailure.signIn ? 'sign_in' : null }}
            links={links}
          />
        ) : null}
        {message ? (
          <p role={message.tone === 'alert' ? 'alert' : 'status'}>{message.text}</p>
        ) : null}
        {queue && !loadFailure ? (
          <>
            <p className="pr-queue-summary">
              <span>{queueWords.summary(items.length, queue.total)}</span>
              <span>{oldestWaitingLine(queue)}</span>
            </p>
            <ul className="pr-queue-rows">
              {items.map((item) => (
                <li key={item.id} className="pr-queue-row">
                  <p className="pr-facts">
                    <code>{item.reference}</code>
                    <span className="ux-badge">{statusLabels[item.status]}</span>
                    <ModeLabel real={item.side === 'real'} />
                    <span>{reporterKindLabels[item.reporterKind]}</span>
                    <span>{whenWords(item.filedAt)}</span>
                    <span>{categoryWords[item.category].label}</span>
                    {item.pageKind === 'this_page' && item.page ? <code>{item.page}</code> : null}
                  </p>
                  <details>
                    <summary>{queueWords.showDetails}</summary>
                    <dl className="pr-summary">
                      {item.wordsRemoved ? (
                        <div>
                          <dt>{queueWords.details}</dt>
                          <dd>{queueWords.wordsGone}</dd>
                        </div>
                      ) : (
                        <>
                          <div>
                            <dt>{queueWords.where}</dt>
                            <dd>{item.page}</dd>
                          </div>
                          <div>
                            <dt>{queueWords.details}</dt>
                            <dd>{item.detail ?? queueWords.nothingAdded}</dd>
                          </div>
                        </>
                      )}
                    </dl>
                    <h3>{queueWords.history}</h3>
                    <ol className="pr-history">
                      {item.history.map((entry, index) => (
                        <li key={`${index}-${entry.createdAt}`}>
                          <strong>{statusLabels[entry.state]}</strong>{' '}
                          <time dateTime={entry.createdAt}>{whenWords(entry.createdAt)}</time>
                          {entry.note ? (
                            <>
                              <br />
                              <em>{queueWords.noteLabel}:</em> {entry.note}
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                  {pending?.item.id === item.id ? null : (
                    <div className="pr-actions">
                      {movesFrom(item.status).map((move) => (
                        <button
                          key={move.to}
                          className="text-link"
                          type="button"
                          disabled={busy || saving || pending !== null}
                          aria-label={`${move.label} ${item.reference}`}
                          onClick={() => choose(item, move)}
                        >
                          {move.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {pending?.item.id === item.id ? (
                    <form
                      className="pr-queue-move"
                      onSubmit={(event) => void save(event)}
                      aria-label={`${pending.move.label} ${item.reference}`}
                      noValidate
                    >
                      <label htmlFor={`note-${item.id}`}>
                        {queueWords.noteLabel}
                        <span className="pr-tag">
                          {pending.move.noteRequired
                            ? queueWords.noteRequired
                            : queueWords.noteOptional}
                        </span>
                      </label>
                      <textarea
                        id={`note-${item.id}`}
                        rows={3}
                        value={note}
                        maxLength={problemReportLimits.note.max}
                        disabled={saving}
                        aria-required={pending.move.noteRequired}
                        aria-invalid={noteError ? true : undefined}
                        aria-describedby={`note-${item.id}-hint note-${item.id}-caution`}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <span id={`note-${item.id}-hint`} className="guide-hint">
                        {queueWords.noteHint}
                      </span>
                      <strong id={`note-${item.id}-caution`}>{queueWords.caution}</strong>
                      {noteError ? <p role="alert">{noteError}</p> : null}
                      {moveFailure ? (
                        <ReportFailure
                          failure={{
                            message: moveFailure.message,
                            link: moveFailure.signIn ? 'sign_in' : null,
                          }}
                          links={links}
                        />
                      ) : null}
                      <div className="pr-actions">
                        <button className="primary-link" type="submit" disabled={saving}>
                          {saving ? queueWords.saving : queueWords.save}
                        </button>
                        <button
                          className="text-link"
                          type="button"
                          disabled={saving}
                          onClick={cancel}
                        >
                          {queueWords.cancel}
                        </button>
                        {moveFailure?.reload ? (
                          <button
                            className="text-link"
                            type="button"
                            disabled={busy || saving}
                            onClick={() => void load(null)}
                          >
                            {busy ? queueWords.reloading : queueWords.reload}
                          </button>
                        ) : null}
                      </div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
            {queue.nextAfter !== null ? (
              <div className="pr-actions">
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => void load(queue.nextAfter)}
                >
                  {queueWords.loadMore}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
