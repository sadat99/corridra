'use client';
import { realCustomerInput } from '@corridra/domain/customer-input-mode';
import { useCallback, useEffect, useRef, useState } from 'react';

type OutcomeKind =
  | 'MEETING_HELD'
  | 'FOLLOW_UP_AGREED'
  | 'SAMPLE_OR_QUOTE_REQUESTED'
  | 'PRELIMINARY_AGREEMENT'
  | 'NO_PROGRESS';
type RecordView = {
  recordId: string;
  kind: 'FEEDBACK' | 'OUTCOME';
  version: number;
  shared: boolean;
  retracted: boolean;
  rating: number | null;
  outcomeKind: OutcomeKind | null;
  occurredOn: string | null;
  note: string | null;
};
type Props = { subject: string; issuer: string; registrationId: string };

export const outcomeLabels: Record<OutcomeKind, string> = {
  MEETING_HELD: 'A meeting was held',
  FOLLOW_UP_AGREED: 'A follow-up was agreed',
  SAMPLE_OR_QUOTE_REQUESTED: realCustomerInput()
    ? 'A or quote was requested'
    : 'A sample or quote was requested',
  PRELIMINARY_AGREEMENT: 'A preliminary agreement was reached',
  NO_PROGRESS: 'No progress yet',
};
const ratingLabels = ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'];
const kinds = Object.keys(outcomeLabels) as OutcomeKind[];
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function today() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function parseRecord(v: unknown, kind: 'FEEDBACK' | 'OUTCOME'): RecordView {
  if (
    !object(v) ||
    !uuid(v.recordId) ||
    v.kind !== kind ||
    !Number.isInteger(v.version) ||
    typeof v.shared !== 'boolean' ||
    typeof v.retracted !== 'boolean' ||
    !(v.note === null || (typeof v.note === 'string' && v.note.length <= 500)) ||
    !(
      v.rating === null ||
      (Number.isInteger(v.rating) && (v.rating as number) >= 1 && (v.rating as number) <= 5)
    ) ||
    !(v.outcomeKind === null || kinds.includes(v.outcomeKind as OutcomeKind)) ||
    !(
      v.occurredOn === null ||
      (typeof v.occurredOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.occurredOn))
    )
  )
    throw Error('Invalid record');
  return v as unknown as RecordView;
}
function parseView(value: unknown, registrationId: string) {
  if (
    !object(value) ||
    value.registrationId !== registrationId ||
    !Array.isArray(value.outcomes) ||
    value.outcomes.length > 50 ||
    typeof value.expiresAt !== 'string'
  )
    throw Error('Invalid records');
  return {
    feedback: value.feedback === null ? null : parseRecord(value.feedback, 'FEEDBACK'),
    outcomes: value.outcomes.map((o) => parseRecord(o, 'OUTCOME')),
    expiresAt: Date.parse(value.expiresAt),
  };
}

export function ParticipantResults(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button
        type="button"
        className="text-link"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide my feedback and results' : 'Share feedback and results'}
      </button>
      {open && (
        <ScopedResults
          key={props.issuer + ':' + props.subject + ':' + props.registrationId}
          {...props}
        />
      )}
    </section>
  );
}

function ScopedResults({ subject, issuer, registrationId }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'denied' | 'unavailable'>(
    'loading',
  );
  const [feedback, setFeedback] = useState<RecordView | null>(null);
  const [outcomes, setOutcomes] = useState<RecordView[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [fbShared, setFbShared] = useState(false);
  const [fbConfirm, setFbConfirm] = useState(false);
  const [kind, setKind] = useState<OutcomeKind>('MEETING_HELD');
  const [occurredOn, setOccurredOn] = useState(today());
  const [note, setNote] = useState(realCustomerInput() ? '' : 'Synthetic ');
  const [ocShared, setOcShared] = useState(false);
  const [ocConfirm, setOcConfirm] = useState(false);
  const active = useRef(true);
  const task = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intent = useRef<{ signature: string; commandId: string } | null>(null);
  const headers = useCallback(
    () => ({ 'x-corridra-customer-subject': subject, 'x-corridra-customer-issuer': issuer }),
    [subject, issuer],
  );
  const clear = useCallback(() => {
    setFeedback(null);
    setOutcomes([]);
    setComment(realCustomerInput() ? '' : 'Synthetic ');
    setNote(realCustomerInput() ? '' : 'Synthetic ');
    setRating(0);
    setFbConfirm(false);
    setOcConfirm(false);
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
        const r = await fetch(
          '/api/customer-programme-coordination?view=records&registrationId=' + registrationId,
          {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: headers(),
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted || !active.current) return;
        if ([401, 403, 409].includes(r.status))
          return lose(
            'denied',
            'Account or programme access changed. Private details were cleared.',
          );
        if (r.status === 503) return lose('unavailable', 'Feedback and results are unavailable.');
        if (!r.ok) throw Error('read failed');
        const v = parseView(await r.json(), registrationId);
        if (controller.signal.aborted || !active.current) return;
        setFeedback(v.feedback);
        setOutcomes(v.outcomes);
        if (v.feedback && !v.feedback.retracted) {
          setRating(v.feedback.rating ?? 0);
          setComment(v.feedback.note ?? (realCustomerInput() ? '' : 'Synthetic '));
          setFbShared(v.feedback.shared);
        }
        if (timer.current) clearTimeout(timer.current);
        const wait = v.expiresAt - Date.now();
        if (!(wait > 0))
          return lose('failed', 'This private view expired. Reload to check access again.');
        timer.current = setTimeout(
          () => lose('failed', 'This private view expired. Reload to check access again.'),
          wait,
        );
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted && active.current)
          lose('failed', 'Your results could not be loaded. Reload to check access and try again.');
      }
    },
    [headers, lose, registrationId],
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

  async function send(input: Record<string, unknown>, done: () => void, message: string) {
    if (writing.current) return;
    const signature = JSON.stringify(input);
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
          action: 'record',
          input: {
            commandId: intent.current.commandId,
            registrationId,
            acknowledged: true,
            ...input,
          },
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
              ? 'Some details are not valid. Check the wording, rating and date.'
              : 'It could not be saved. What you typed is kept; try again.',
        );
        return;
      }
      if (!object(body) || !object(body.record)) throw Error('Unconfirmed record');
      parseRecord(body.record, body.record.kind === 'OUTCOME' ? 'OUTCOME' : 'FEEDBACK');
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

  function saveFeedback() {
    setError('');
    if (rating < 1) return setError('Choose a rating from 1 to 5.');
    if (comment.trim() !== 'Synthetic' && !textOk(comment))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the comment with the word Synthetic and add a few words, or leave it empty.',
      );
    if (!fbConfirm)
      return setError(
        realCustomerInput()
          ? 'Confirm that this feedback reflects your experience.'
          : 'Confirm that this is fictional sample feedback.',
      );
    void send(
      {
        kind: 'FEEDBACK',
        recordId: feedback?.recordId ?? null,
        expectedVersion: feedback?.version ?? 0,
        rating,
        outcomeKind: null,
        occurredOn: null,
        note: comment.trim() === 'Synthetic' ? null : comment.trim(),
        shared: fbShared,
        retracted: false,
      },
      () => setFbConfirm(false),
      fbShared
        ? 'Feedback saved and shared with the organiser.'
        : 'Feedback saved. The organiser cannot see it.',
    );
  }
  function addOutcome() {
    setError('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return setError('Choose a date.');
    if (!textOk(note))
      return setError(
        realCustomerInput()
          ? 'Enter a clear description with at least two characters.'
          : 'Start the note with the word Synthetic and add a few words.',
      );
    if (!ocConfirm)
      return setError(
        realCustomerInput()
          ? 'Confirm that this is your own reported result.'
          : 'Confirm that this is a fictional sample result.',
      );
    void send(
      {
        kind: 'OUTCOME',
        recordId: null,
        expectedVersion: 0,
        rating: null,
        outcomeKind: kind,
        occurredOn,
        note: note.trim(),
        shared: ocShared,
        retracted: false,
      },
      () => {
        setNote(realCustomerInput() ? '' : 'Synthetic ');
        setOcConfirm(false);
        setOcShared(false);
      },
      ocShared
        ? 'Result saved and shared with the organiser.'
        : 'Result saved. The organiser cannot see it.',
    );
  }
  function change(r: RecordView, patch: { shared?: boolean; retracted?: boolean }) {
    setError('');
    const retracted = patch.retracted ?? false;
    void send(
      {
        kind: r.kind,
        recordId: r.recordId,
        expectedVersion: r.version,
        rating: r.rating,
        outcomeKind: r.outcomeKind,
        occurredOn: r.occurredOn,
        note: r.note,
        shared: retracted ? false : (patch.shared ?? r.shared),
        retracted,
      },
      () => undefined,
      retracted
        ? 'Withdrawn. The organiser can no longer see it.'
        : patch.shared
          ? 'Now shared with the organiser.'
          : 'No longer shared with the organiser.',
    );
  }

  return (
    <div className="operator-form" aria-busy={busy || status === 'loading'}>
      <h4>My feedback and results</h4>
      <p>
        {realCustomerInput()
          ? 'This is your own reported record. The organiser sees an item only if you choose to share it, and you can stop sharing or withdraw it at any time. Do not enter prices, contract values or contact details. Corridra does not confirm what you report.'
          : 'This is your own fictional sample record. The organiser sees an item only if you choose to share it, and you can stop sharing or withdraw it at any time. Do not enter prices, contract values or contact details. Corridra does not confirm what you report.'}{' '}
      </p>
      {status === 'loading' && <p role="status">Loading your feedback and results…</p>}
      {status === 'unavailable' && <p role="status">{notice}</p>}
      {(status === 'denied' || status === 'failed') && (
        <>
          <p role="alert">{notice}</p>
          {status === 'failed' && (
            <button type="button" className="text-link" onClick={() => void load()}>
              Reload my feedback and results
            </button>
          )}
        </>
      )}
      {status === 'ready' && (
        <>
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveFeedback();
            }}
          >
            <fieldset>
              <legend>How satisfied are you with this programme?</legend>
              {ratingLabels.map((label, i) => (
                <label key={label} className="check-field">
                  <input
                    type="radio"
                    name={'rating-' + registrationId}
                    checked={rating === i + 1}
                    disabled={busy || !!feedback?.retracted}
                    onChange={() => setRating(i + 1)}
                  />
                  {i + 1} · {label}
                </label>
              ))}
            </fieldset>
            <label className="field">
              {realCustomerInput()
                ? 'Comment (optional)'
                : 'Comment (optional, start with Synthetic)'}{' '}
              <input
                type="text"
                maxLength={500}
                value={comment}
                disabled={busy || !!feedback?.retracted}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={fbShared}
                disabled={busy || !!feedback?.retracted}
                onChange={(e) => setFbShared(e.target.checked)}
              />
              Share this feedback with the organiser (your name is not shown with it)
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={fbConfirm}
                disabled={busy || !!feedback?.retracted}
                onChange={(e) => setFbConfirm(e.target.checked)}
              />
              {realCustomerInput()
                ? 'I confirm this feedback reflects my experience.'
                : 'This is fictional sample feedback.'}{' '}
            </label>
            {feedback?.retracted ? (
              <p>You withdrew your feedback. It is kept for your own history and is not shared.</p>
            ) : (
              <button type="submit" className="primary-link" disabled={busy}>
                {feedback ? 'Update feedback' : 'Save feedback'}
              </button>
            )}
            {feedback && !feedback.retracted && (
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => change(feedback, { retracted: true })}
              >
                Withdraw my feedback
              </button>
            )}
          </form>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              addOutcome();
            }}
          >
            <h5>Add a result</h5>
            <label className="field">
              What happened?
              <select
                value={kind}
                disabled={busy}
                onChange={(e) => setKind(e.target.value as OutcomeKind)}
              >
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {outcomeLabels[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Date
              <input
                type="date"
                value={occurredOn}
                min="2000-01-01"
                max={today()}
                disabled={busy}
                onChange={(e) => setOccurredOn(e.target.value)}
              />
            </label>
            <label className="field">
              {realCustomerInput() ? 'Note' : 'Note (start with Synthetic)'}{' '}
              <input
                type="text"
                maxLength={500}
                value={note}
                disabled={busy}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={ocShared}
                disabled={busy}
                onChange={(e) => setOcShared(e.target.checked)}
              />
              Share this result with the organiser (your programme name is shown with it)
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={ocConfirm}
                disabled={busy}
                onChange={(e) => setOcConfirm(e.target.checked)}
              />
              {realCustomerInput()
                ? 'I confirm this is my reported result. It has not been independently verified.'
                : 'This is a fictional sample result.'}{' '}
            </label>
            <button type="submit" className="primary-link" disabled={busy}>
              Add result
            </button>
          </form>

          <h5>My results</h5>
          {outcomes.length === 0 ? (
            <p className="ux-empty">No results added yet.</p>
          ) : (
            <ul>
              {outcomes.map((o) => (
                <li key={o.recordId}>
                  {outcomeLabels[o.outcomeKind!]} · {o.occurredOn}
                  <br />
                  {o.note}
                  <br />
                  {o.retracted ? (
                    <span>Withdrawn · not shared</span>
                  ) : (
                    <>
                      <span>{o.shared ? 'Shared with the organiser' : 'Not shared'}</span>{' '}
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy}
                        onClick={() => change(o, { shared: !o.shared })}
                      >
                        {o.shared ? 'Stop sharing' : 'Share with the organiser'}
                      </button>{' '}
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy}
                        onClick={() => change(o, { retracted: true })}
                      >
                        Withdraw this result
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
