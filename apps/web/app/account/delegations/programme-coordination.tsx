'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { outcomeLabels } from './participant-results';

type Status = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';
type Task = {
  id: string;
  seq: number;
  version: number;
  title: string;
  detail: string | null;
  status: Status;
  dueOn: string | null;
  assigneeLabel: string | null;
};
type Report = {
  asOf: string;
  activeParticipants: number;
  capacity: { capacity: number | null; version: number; reason: string | null };
  attendance: { attended: number; absent: number; notRecorded: number; withdrawnOrRemoved: number };
  tasks: { open: number; inProgress: number; done: number; cancelled: number; overdue: number };
  feedback: {
    responses: number;
    shared: number;
    notShared: number;
    ratingCount: number;
    ratingSum: number;
    distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
    comments: string[];
  };
  outcomes: {
    total: number;
    shared: number;
    notShared: number;
    byKind: Record<string, number>;
    items: { label: string; outcomeKind: string; occurredOn: string; note: string | null }[];
  };
  repeat: { returningParticipants: number };
  participants: {
    registrationId: string;
    label: string;
    state: 'ACTIVE' | 'WITHDRAWN' | 'REMOVED';
    attendance: 'ATTENDED' | 'ABSENT' | null;
    attendanceVersion: number;
  }[];
};
type Props = { subject: string; issuer: string; workspaceId: string; programmeId: string };

const statusLabels: Record<Status, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};
const statuses = Object.keys(statusLabels) as Status[];
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e7;
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= max;
const day = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
function parseTask(v: unknown): Task {
  if (
    !object(v) ||
    !uuid(v.id) ||
    !Number.isInteger(v.seq) ||
    !Number.isInteger(v.version) ||
    !text(v.title, 160) ||
    !(v.detail === null || text(v.detail, 1000)) ||
    !statuses.includes(v.status as Status) ||
    !(v.dueOn === null || day(v.dueOn)) ||
    !(v.assigneeLabel === null || text(v.assigneeLabel, 120))
  )
    throw Error('Invalid task');
  return v as unknown as Task;
}
function parseReport(value: unknown, p: Props): Report {
  if (
    !object(value) ||
    value.workspaceId !== p.workspaceId ||
    value.programmeId !== p.programmeId ||
    value.verified !== false ||
    value.sendsMessages !== false ||
    !count(value.activeParticipants) ||
    !object(value.capacity) ||
    !object(value.attendance) ||
    !object(value.tasks) ||
    !object(value.feedback) ||
    !object(value.outcomes) ||
    !object(value.repeat) ||
    !Array.isArray(value.participants) ||
    value.participants.length > 5000
  )
    throw Error('Invalid report');
  const { capacity, attendance, tasks, feedback, outcomes, repeat } = value;
  if (
    !(capacity.capacity === null || count(capacity.capacity)) ||
    !count(capacity.version) ||
    ![
      attendance.attended,
      attendance.absent,
      attendance.notRecorded,
      attendance.withdrawnOrRemoved,
    ].every(count) ||
    ![tasks.open, tasks.inProgress, tasks.done, tasks.cancelled, tasks.overdue].every(count) ||
    ![
      feedback.responses,
      feedback.shared,
      feedback.notShared,
      feedback.ratingCount,
      feedback.ratingSum,
    ].every(count) ||
    !object(feedback.distribution) ||
    !Array.isArray(feedback.comments) ||
    !feedback.comments.every((c) => text(c, 500)) ||
    ![outcomes.total, outcomes.shared, outcomes.notShared].every(count) ||
    !object(outcomes.byKind) ||
    !Array.isArray(outcomes.items) ||
    !count(repeat.returningParticipants)
  )
    throw Error('Invalid report figures');
  for (const k of ['1', '2', '3', '4', '5'])
    if (!count((feedback.distribution as Record<string, unknown>)[k]))
      throw Error('Invalid distribution');
  for (const [k, n] of Object.entries(outcomes.byKind))
    if (!(k in outcomeLabels) || !count(n)) throw Error('Invalid outcomes');
  for (const i of outcomes.items)
    if (
      !object(i) ||
      !text(i.label, 200) ||
      !((i.outcomeKind as string) in outcomeLabels) ||
      !day(i.occurredOn) ||
      !(i.note === null || text(i.note, 500))
    )
      throw Error('Invalid outcome item');
  for (const r of value.participants)
    if (
      !object(r) ||
      !uuid(r.registrationId) ||
      !text(r.label, 200) ||
      !['ACTIVE', 'WITHDRAWN', 'REMOVED'].includes(String(r.state)) ||
      !(r.attendance === null || r.attendance === 'ATTENDED' || r.attendance === 'ABSENT')
    )
      throw Error('Invalid participant');
  return value as unknown as Report;
}
function parseTasks(value: unknown, p: Props) {
  if (
    !object(value) ||
    value.workspaceId !== p.workspaceId ||
    value.programmeId !== p.programmeId ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > 100 ||
    !(value.nextAfter === null || Number.isInteger(value.nextAfter)) ||
    typeof value.expiresAt !== 'string'
  )
    throw Error('Invalid tasks');
  return {
    tasks: value.tasks.map(parseTask),
    nextAfter: value.nextAfter as number | null,
    expiresAt: Date.parse(value.expiresAt),
  };
}
// Exact one-decimal average from integers, with no floating point in the arithmetic.
export function averageRating(sum: number, n: number) {
  if (n === 0) return null;
  const tenths = Math.floor((sum * 20 + n) / (n * 2));
  return Math.floor(tenths / 10) + '.' + (tenths % 10);
}

export function ProgrammeCoordination(props: Props) {
  return (
    <ScopedCoordination
      key={props.issuer + ':' + props.subject + ':' + props.workspaceId + ':' + props.programmeId}
      {...props}
    />
  );
}

function ScopedCoordination(props: Props) {
  const { subject, issuer, workspaceId, programmeId } = props;
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'denied' | 'unavailable'>(
    'loading',
  );
  const [report, setReport] = useState<Report | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nextAfter, setNextAfter] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [capacity, setCapacity] = useState('');
  const [capacityReason, setCapacityReason] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [detail, setDetail] = useState('');
  const [taskStatus, setTaskStatus] = useState<Status>('OPEN');
  const [dueOn, setDueOn] = useState('');
  const [assignee, setAssignee] = useState('');
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const headers = useCallback(
    () => ({ 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer }),
    [subject, issuer],
  );
  const scopeQuery = 'workspaceId=' + workspaceId + '&programmeId=' + programmeId;
  const clear = useCallback(() => {
    setReport(null);
    setTasks([]);
    setNextAfter(null);
    setCapacity('');
    setCapacityReason(realCustomerInput() ? '' : 'Synthetic ');
    setEditing(null);
    setTitle(realCustomerInput() ? '' : 'Synthetic ');
    setDetail('');
    setDueOn('');
    setAssignee('');
    intent.current = null;
  }, []);
  const lose = useCallback(
    (to: 'denied' | 'failed' | 'unavailable', message: string) => {
      if (timer.current) clearTimeout(timer.current);
      clear();
      setStatus(to);
      setNotice(message);
    },
    [clear],
  );
  const load = useCallback(
    async (keepNotice = false) => {
      task.current?.abort();
      const controller = new AbortController();
      task.current = controller;
      setStatus((current) => (current === 'ready' ? current : 'loading'));
      if (!keepNotice) setNotice('');
      try {
        const options = {
          cache: 'no-store' as const,
          credentials: 'same-origin' as const,
          headers: headers(),
          signal: controller.signal,
        };
        const [a, b] = await Promise.all([
          fetch('/api/customer-programme-coordination?view=report&' + scopeQuery, options),
          fetch(
            '/api/customer-programme-coordination?view=tasks&pageSize=100&' + scopeQuery,
            options,
          ),
        ]);
        if (controller.signal.aborted || !active.current) return;
        if ([a, b].some((r) => [401, 403, 409].includes(r.status)))
          return lose(
            'denied',
            'Account or programme access changed. Private details were cleared.',
          );
        if ([a, b].some((r) => r.status === 503))
          return lose('unavailable', 'Sample delegation coordination is unavailable.');
        if (!a.ok || !b.ok) throw Error('read failed');
        const scope = { subject, issuer, workspaceId, programmeId };
        const rep = parseReport(await a.json(), scope);
        const list = parseTasks(await b.json(), scope);
        if (controller.signal.aborted || !active.current) return;
        setReport(rep);
        setTasks(list.tasks);
        setNextAfter(list.nextAfter);
        if (timer.current) clearTimeout(timer.current);
        const wait = list.expiresAt - Date.now();
        if (!(wait > 0))
          return lose('failed', 'This private view expired. Reload to check access again.');
        timer.current = setTimeout(
          () => lose('failed', 'This private view expired. Reload to check access again.'),
          wait,
        );
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted && active.current)
          lose('failed', 'Coordination could not be loaded. Reload to check access and try again.');
      }
    },
    [headers, lose, scopeQuery, subject, issuer, workspaceId, programmeId],
  );
  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void load();
    });
    return () => {
      active.current = false;
      task.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (busy || capacity || editing !== null || title.trim() !== 'Synthetic') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [busy, capacity, editing, title]);

  async function older() {
    if (nextAfter === null || busy) return;
    setBusy(true);
    try {
      const r = await fetch(
        '/api/customer-programme-coordination?view=tasks&pageSize=100&afterSeq=' +
          nextAfter +
          '&' +
          scopeQuery,
        { cache: 'no-store', credentials: 'same-origin', headers: headers() },
      );
      if ([401, 403, 409].includes(r.status))
        return lose('denied', 'Account or programme access changed. Private details were cleared.');
      if (!r.ok) throw Error('read failed');
      const list = parseTasks(await r.json(), { subject, issuer, workspaceId, programmeId });
      setTasks((old) => [...old, ...list.tasks.filter((t) => !old.some((o) => o.id === t.id))]);
      setNextAfter(list.nextAfter);
    } catch {
      setError('More tasks could not be loaded. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function send(
    action: string,
    input: Record<string, unknown>,
    done: () => void,
    message: string,
  ) {
    if (writing.current) return;
    const signature = action + JSON.stringify(input);
    if (intent.current?.signature !== signature)
      intent.current = { signature, commandId: crypto.randomUUID() };
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/customer-programme-coordination', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', ...headers() },
        body: JSON.stringify({
          action,
          input: { commandId: intent.current.commandId, workspaceId, programmeId, ...input },
        }),
      });
      const body: unknown = await r.json().catch(() => null);
      const changed =
        r.status === 409 &&
        object(body) &&
        typeof body.error === 'string' &&
        body.error.includes('account changed');
      if ([401, 403].includes(r.status) || changed)
        return lose('denied', 'Account or programme access changed. Private details were cleared.');
      if (!r.ok) {
        setError(
          r.status === 409
            ? 'This changed since you opened it. Reload to see the latest, then try again.'
            : r.status === 400
              ? 'Some details are not valid. Check the wording, date and numbers.'
              : 'It could not be saved. What you typed is kept; try again.',
        );
        return;
      }
      if (!object(body) || typeof body.commandId !== 'string') throw Error('Unconfirmed');
      intent.current = null;
      done();
      setNotice(message);
      await load(true);
    } catch {
      setError('It could not be confirmed. What you typed is kept; try again.');
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }
  const textOk = (v: string) =>
    realCustomerInput() ? v.trim().length >= 2 : /^Synthetic .{3,}/.test(v.trim());

  function saveCapacity() {
    setError('');
    if (!/^[1-9][0-9]{0,4}$/.test(capacity) || Number(capacity) > 10000)
      return setError('Enter a whole number from 1 to 10000.');
    if (!textOk(capacityReason))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the reason with the word Synthetic and add a few words.',
      );
    void send(
      'capacity',
      {
        expectedVersion: report!.capacity.version,
        capacity: Number(capacity),
        reason: capacityReason.trim(),
      },
      () => {
        setCapacity('');
        setCapacityReason(realCustomerInput() ? '' : 'Synthetic ');
      },
      'Capacity saved.',
    );
  }
  function mark(registrationId: string, state: 'ATTENDED' | 'ABSENT') {
    void send('attendance', { registrationId, state }, () => undefined, 'Attendance saved.');
  }
  function startEdit(t: Task | null) {
    setError('');
    setEditing(t ? t.id : 'new');
    setTitle(t ? t.title : realCustomerInput() ? '' : 'Synthetic ');
    setDetail(t?.detail ?? '');
    setTaskStatus(t ? t.status : 'OPEN');
    setDueOn(t?.dueOn ?? '');
    setAssignee(t?.assigneeLabel ?? '');
  }
  function saveTask() {
    setError('');
    const existing = editing && editing !== 'new' ? tasks.find((t) => t.id === editing) : null;
    if (!textOk(title))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the task title with the word Synthetic and add a few words.',
      );
    if (detail.trim() && !textOk(detail))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the detail with the word Synthetic and add a few words, or clear it.',
      );
    if (assignee.trim() && !textOk(assignee))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the assignee with the word Synthetic and add a few words, or clear it.',
      );
    if (dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(dueOn))
      return setError('Choose a valid due date or clear it.');
    void send(
      'task',
      {
        expectedVersion: existing ? existing.version : 0,
        task: {
          taskId: existing ? existing.id : null,
          title: title.trim(),
          detail: detail.trim() || null,
          status: existing ? taskStatus : 'OPEN',
          dueOn: dueOn || null,
          assigneeLabel: assignee.trim() || null,
        },
      },
      () => setEditing(null),
      existing ? 'Task updated.' : 'Task added.',
    );
  }

  const avg = report ? averageRating(report.feedback.ratingSum, report.feedback.ratingCount) : null;
  const over =
    report &&
    report.capacity.capacity !== null &&
    report.activeParticipants > report.capacity.capacity;

  return (
    <section
      className="detail-card"
      aria-label="Sample programme coordination"
      aria-busy={busy || status === 'loading'}
    >
      <h4>Coordinate and report</h4>
      <p>
        Tasks, capacity and attendance are your own records. Feedback and results are reported by
        participants and shown only if they chose to share them. Nothing here is confirmed by
        Corridra, and no message is sent to anyone.
      </p>
      {status === 'loading' && (
        <p role="status">
          {' '}
          {realCustomerInput() ? 'Loading coordination…' : 'Loading sample coordination…'}{' '}
        </p>
      )}
      {status === 'unavailable' && <p role="status">{notice}</p>}
      {(status === 'denied' || status === 'failed') && (
        <>
          <p role="alert">{notice}</p>
          {status === 'failed' && (
            <button type="button" className="text-link" onClick={() => void load()}>
              Reload coordination
            </button>
          )}
        </>
      )}
      {status === 'ready' && report && (
        <>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          <h5>Programme report as of {report.asOf}</h5>
          <table>
            <caption>Plan and results</caption>
            <tbody>
              <tr>
                <th scope="row">Active participants (you recorded)</th>
                <td>
                  {report.activeParticipants}
                  {report.capacity.capacity !== null
                    ? ' of ' + report.capacity.capacity + ' places'
                    : ' (no capacity set)'}
                  {over ? ' · over capacity' : ''}
                </td>
              </tr>
              <tr>
                <th scope="row">Attendance (you recorded)</th>
                <td>
                  {report.attendance.attended} attended · {report.attendance.absent} absent ·{' '}
                  {report.attendance.notRecorded} not recorded
                  {report.attendance.withdrawnOrRemoved
                    ? ' · ' + report.attendance.withdrawnOrRemoved + ' withdrawn or removed'
                    : ''}
                </td>
              </tr>
              <tr>
                <th scope="row">Tasks (you recorded)</th>
                <td>
                  {report.tasks.open} open · {report.tasks.inProgress} in progress ·{' '}
                  {report.tasks.done} done · {report.tasks.cancelled} cancelled ·{' '}
                  {report.tasks.overdue} overdue
                </td>
              </tr>
              <tr>
                <th scope="row">Satisfaction (reported by participants)</th>
                <td>
                  {avg === null
                    ? 'No shared ratings yet'
                    : avg +
                      ' out of 5 from ' +
                      report.feedback.ratingCount +
                      ' shared rating' +
                      (report.feedback.ratingCount === 1 ? '' : 's')}
                  {report.feedback.notShared
                    ? ' · ' + report.feedback.notShared + ' not shared with you'
                    : ''}
                </td>
              </tr>
              <tr>
                <th scope="row">Results (reported by participants)</th>
                <td>
                  {report.outcomes.shared} shared with you
                  {report.outcomes.notShared
                    ? ' · ' + report.outcomes.notShared + ' not shared'
                    : ''}
                  {Object.entries(report.outcomes.byKind).map(([k, n]) => (
                    <span key={k}>
                      {' '}
                      · {outcomeLabels[k as keyof typeof outcomeLabels]}: {n}
                    </span>
                  ))}
                </td>
              </tr>
              <tr>
                <th scope="row">Returning participants</th>
                <td>
                  {report.repeat.returningParticipants} also registered in another programme of this
                  workspace
                </td>
              </tr>
            </tbody>
          </table>
          {report.feedback.comments.length > 0 && (
            <>
              <h5>Shared comments (names are not shown)</h5>
              <ul>
                {report.feedback.comments.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}
          {report.outcomes.items.length > 0 && (
            <>
              <h5>Shared results</h5>
              <ul>
                {report.outcomes.items.map((o, i) => (
                  <li key={i}>
                    {o.label} · {outcomeLabels[o.outcomeKind as keyof typeof outcomeLabels]} ·{' '}
                    {o.occurredOn}
                    {o.note ? ' · ' + o.note : ''}
                  </li>
                ))}
              </ul>
            </>
          )}

          <form
            className="operator-form"
            onSubmit={(e) => {
              e.preventDefault();
              saveCapacity();
            }}
          >
            <h5>Capacity</h5>
            <label className="field">
              Places available
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={capacity}
                disabled={busy}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </label>
            <label className="field">
              {realCustomerInput() ? 'Reason' : 'Reason (start with Synthetic)'}{' '}
              <input
                type="text"
                maxLength={300}
                value={capacityReason}
                disabled={busy}
                onChange={(e) => setCapacityReason(e.target.value)}
              />
            </label>
            <button type="submit" className="primary-link" disabled={busy}>
              Save capacity
            </button>
          </form>

          <h5>Attendance</h5>
          {report.participants.length === 0 ? (
            <p className="ux-empty">No registered participants yet.</p>
          ) : (
            <ul>
              {report.participants.map((p) => (
                <li key={p.registrationId}>
                  <strong>{p.label}</strong> ·{' '}
                  {p.state !== 'ACTIVE'
                    ? p.state === 'WITHDRAWN'
                      ? 'withdrawn'
                      : 'removed'
                    : p.attendance === 'ATTENDED'
                      ? 'attended'
                      : p.attendance === 'ABSENT'
                        ? 'absent'
                        : 'not recorded'}
                  {p.state === 'ACTIVE' && (
                    <>
                      {' '}
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy || p.attendance === 'ATTENDED'}
                        onClick={() => mark(p.registrationId, 'ATTENDED')}
                      >
                        Mark attended for {p.label}
                      </button>{' '}
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy || p.attendance === 'ABSENT'}
                        onClick={() => mark(p.registrationId, 'ABSENT')}
                      >
                        Mark absent for {p.label}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h5>Tasks</h5>
          {tasks.length === 0 ? (
            <p className="ux-empty">No tasks yet.</p>
          ) : (
            <ul>
              {tasks.map((t) => (
                <li key={t.id}>
                  <strong>{t.title}</strong> · {statusLabels[t.status]}
                  {t.dueOn ? ' · due ' + t.dueOn : ''}
                  {t.assigneeLabel ? ' · ' + t.assigneeLabel : ''}
                  {t.detail ? (
                    <>
                      <br />
                      {t.detail}
                    </>
                  ) : null}{' '}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => startEdit(editing === t.id ? null : t)}
                  >
                    {editing === t.id ? 'Cancel editing' : 'Edit task ' + t.seq}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {nextAfter !== null && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => void older()}
            >
              Show more tasks
            </button>
          )}
          {editing === null && (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => startEdit(null)}
            >
              Add a task
            </button>
          )}
          {editing !== null && (
            <form
              className="operator-form"
              onSubmit={(e) => {
                e.preventDefault();
                saveTask();
              }}
            >
              <h5>{editing === 'new' ? 'New task' : 'Edit task'}</h5>
              <label className="field">
                {realCustomerInput() ? 'Title' : 'Title (start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={160}
                  value={title}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="field">
                {realCustomerInput()
                  ? 'Detail (optional)'
                  : 'Detail (optional, start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={1000}
                  value={detail}
                  disabled={busy}
                  onChange={(e) => setDetail(e.target.value)}
                />
              </label>
              {editing !== 'new' && (
                <label className="field">
                  Status
                  <select
                    value={taskStatus}
                    disabled={busy}
                    onChange={(e) => setTaskStatus(e.target.value as Status)}
                  >
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {statusLabels[s]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Due date (optional)
                <input
                  type="date"
                  value={dueOn}
                  min="2000-01-01"
                  max="2100-01-01"
                  disabled={busy}
                  onChange={(e) => setDueOn(e.target.value)}
                />
              </label>
              <label className="field">
                {realCustomerInput()
                  ? 'Who is responsible (optional)'
                  : 'Who is responsible (optional, start with Synthetic)'}{' '}
                <input
                  type="text"
                  maxLength={120}
                  value={assignee}
                  disabled={busy}
                  onChange={(e) => setAssignee(e.target.value)}
                />
              </label>
              <button type="submit" className="primary-link" disabled={busy}>
                {editing === 'new' ? 'Add task' : 'Save task'}
              </button>
            </form>
          )}
          <p>Messages to participants, schedules and change notices are not available here.</p>
        </>
      )}
    </section>
  );
}
