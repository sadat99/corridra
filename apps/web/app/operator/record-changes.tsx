'use client';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Dialog } from '../../components/ux/dialog';
import { DateTimeInput } from '../../components/ux/date-time-input';
import { ActionError, withStepUp } from '../../lib/ux/step-up';
import { limitWords } from '../../lib/account-limit';

// CRUD G11 (ADR-017 amendment): withdraw, correct and hide one private contact or note. One item is one group: the
// content line, the state line, the actions, then the history. The server and the database are the control; the
// buttons only follow the role and the per-relationship hint. Hidden text arrives as null with status HIDDEN and is
// written here as the word "Hidden"; the words for a hide say only that the text is hidden.
export type ChangeRow = { id: string; [key: string]: unknown };
export type Changes = { installed: boolean; open: boolean };
export type Subject = 'contact' | 'note';
export type ChangeContext = {
  role: string;
  changes: Changes;
  purpose: string;
  sources: ChangeRow[];
  who: (id: unknown) => string;
  busy: boolean;
  send: (body: Record<string, unknown>) => Promise<unknown>;
  done: (message: string, chain: string) => Promise<void>;
  reload: () => Promise<void>;
};

const stateWords: Record<string, string> = {
  SOURCE_REPORTED: 'Source-reported',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
  CORRECTED: 'Corrected',
  HIDDEN: 'Hidden',
};
export const stateWord = (status: unknown) => stateWords[String(status)] ?? String(status ?? '');
/** `10 Nov 2026, 14:05 UTC`. */
export function at(value: unknown) {
  if (!value) return 'Not recorded';
  return `${new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(String(value)))} UTC`;
}
const hidden = (row: ChangeRow) => row.status === 'HIDDEN';
/** A text field as shown: the word Hidden for a hidden chain, never null, undefined or an empty cell. */
export const shown = (row: ChangeRow, key: string) =>
  hidden(row) ? 'Hidden' : String(row[key] ?? '') || 'Not recorded';

/** One line under the "Private relationships" heading when the actions cannot be used. */
export function ChangeAvailability({ changes }: { changes: Changes }) {
  if (!changes.installed)
    return <p>Withdraw, correct and hide are not available in this workspace yet.</p>;
  if (!changes.open)
    return (
      <p>
        Withdraw, correct and hide are not open yet in this workspace. You can still read every
        contact, note and change.
      </p>
    );
  return null;
}

/** Groups versions by chain: the current line is the version that was not corrected. */
export function chains(rows: ChangeRow[]) {
  const groups = new Map<string, ChangeRow[]>();
  for (const row of rows) {
    const chain = String(row.chain_id ?? row.id);
    groups.set(chain, [...(groups.get(chain) ?? []), row]);
  }
  return [...groups.entries()].map(([chain, versions]) => ({
    chain,
    versions,
    // The version no correction superseded. In a hidden chain every version reads HIDDEN, so the change kind decides.
    current: versions.find((v) => v.change_kind !== 'CORRECT') ?? versions[versions.length - 1]!,
  }));
}

function contentLine(subject: Subject, row: ChangeRow) {
  const badge = <span className="ux-badge">{stateWord(row.status)}</span>;
  return subject === 'contact' ? (
    <p>
      {shown(row, 'name')} · {shown(row, 'job_title')} · {shown(row, 'email')} · {badge} · Source{' '}
      {String(row.source_id)} · Until {at(row.valid_until)}
    </p>
  ) : (
    <p>
      Private note: {shown(row, 'body')} · {badge} · Source {String(row.source_id)} ·{' '}
      {at(row.created_at)}
    </p>
  );
}

function stateSentence(row: ChangeRow, ctx: ChangeContext) {
  const owners = ['owner', 'admin'].includes(ctx.role);
  if (row.status === 'EXPIRED')
    return "Past its valid-until date or its source's keep-until date. You can still withdraw or correct it.";
  if (row.status === 'WITHDRAWN')
    return `Withdrawn on ${at(row.changed_at)} by ${ctx.who(row.changed_by)}. Reason: ${String(row.change_reason)}`;
  if (row.status === 'HIDDEN')
    return `Hidden on ${at(row.hidden_at)} by ${ctx.who(row.hidden_by)}.${
      owners && row.redaction_reason
        ? ` Reason: ${String(row.redaction_reason)} · Ticket: ${String(row.ticket_reference)}`
        : ''
    }`;
  return null;
}

function History({
  subject,
  versions,
  current,
  ctx,
}: {
  subject: Subject;
  versions: ChangeRow[];
  current: ChangeRow;
  ctx: ChangeContext;
}) {
  const entries: ReactNode[] = [];
  const reason = (row: ChangeRow) => (hidden(row) ? 'Hidden' : String(row.change_reason));
  if (hidden(current))
    entries.push(
      <li key="hidden">
        Hidden on {at(current.hidden_at)} by {ctx.who(current.hidden_by)}.
        {['owner', 'admin'].includes(ctx.role) && current.redaction_reason
          ? ` Reason: ${String(current.redaction_reason)} · Ticket: ${String(current.ticket_reference)}`
          : ''}
      </li>,
    );
  if (current.change_kind === 'WITHDRAW')
    entries.push(
      <li key="withdrawn">
        Withdrawn on {at(current.changed_at)} by {ctx.who(current.changed_by)}. Reason:{' '}
        {reason(current)}
      </li>,
    );
  const older = versions
    .filter((v) => v.status === 'CORRECTED' || (hidden(v) && v.change_kind === 'CORRECT'))
    .sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)));
  for (const v of older)
    entries.push(
      <li key={v.id}>
        Corrected on {at(v.changed_at)} by {ctx.who(v.changed_by)}. Reason: {reason(v)}
        <br />
        Before:{' '}
        {subject === 'contact'
          ? `${shown(v, 'name')} · ${shown(v, 'job_title')} · ${shown(v, 'email')} · Source ${String(v.source_id)} · Until ${at(v.valid_until)}`
          : `${shown(v, 'body')} · Source ${String(v.source_id)}`}
      </li>,
    );
  if (!entries.length) return null;
  const first = versions.find((v) => !older.some((o) => o.replacement_id === v.id)) ?? current;
  entries.push(
    <li key="added">
      Added on {at(first.created_at)}
      {first.created_by ? ` by ${ctx.who(first.created_by)}` : ''}
    </li>,
  );
  return (
    <details className="research-history">
      <summary>Earlier versions and changes ({entries.length})</summary>
      <ol>{entries}</ol>
    </details>
  );
}

type Mode = 'withdraw' | 'correct' | 'hide';
const titles: Record<Subject, Record<Mode, string>> = {
  contact: {
    withdraw: 'Withdraw This Contact?',
    correct: 'Correct This Contact',
    hide: "Hide This Contact's Details?",
  },
  note: { withdraw: 'Withdraw This Note?', correct: 'Correct This Note', hide: 'Hide This Note?' },
};
const success: Record<Subject, Record<Mode, string>> = {
  contact: {
    withdraw: 'Contact withdrawn. It stays in the history, marked Withdrawn.',
    correct: 'Correction saved. The earlier version stays in the history, marked Corrected.',
    hide: 'Contact details hidden. The record stays, and its details now show as Hidden.',
  },
  note: {
    withdraw: 'Note withdrawn. It stays in the history, marked Withdrawn.',
    correct: 'Note correction saved. The earlier version stays in the history, marked Corrected.',
    hide: 'Note hidden. The record stays, and its text now shows as Hidden.',
  },
};

/** One contact or note chain with its actions and history. */
export function RecordItem({
  subject,
  versions,
  current,
  chain,
  canChange,
  ownerName,
  ctx,
}: {
  subject: Subject;
  versions: ChangeRow[];
  current: ChangeRow;
  chain: string;
  canChange: boolean;
  ownerName: string;
  ctx: ChangeContext;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const open = ctx.changes.installed && ctx.changes.open;
  const editable = ['SOURCE_REPORTED', 'EXPIRED'].includes(String(current.status));
  const label =
    subject === 'contact'
      ? hidden(current)
        ? 'Contact: details hidden'
        : `Contact: ${String(current.name)}`
      : `Private note from ${at(current.created_at)}`;
  const sentence = stateSentence(current, ctx);
  const noun = subject === 'contact' ? 'Contact' : 'Note';
  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={-1}
      data-state={String(current.status)}
      data-chain={chain}
      className="research-item"
    >
      {contentLine(subject, current)}
      {sentence && <p className="research-item-state">{sentence}</p>}
      {open && (
        <div className="operator-toolbar research-item-actions">
          {editable && canChange && (
            <>
              <button
                type="button"
                className="button button-secondary"
                disabled={ctx.busy}
                onClick={() => setMode('correct')}
              >
                Correct {noun}
              </button>
              <button
                type="button"
                className="button button-secondary"
                data-intent="destructive"
                disabled={ctx.busy}
                onClick={() => setMode('withdraw')}
              >
                Withdraw {noun}
              </button>
            </>
          )}
          {!hidden(current) && ['owner', 'admin'].includes(ctx.role) && (
            <button
              type="button"
              className="button button-secondary"
              data-intent="destructive"
              disabled={ctx.busy}
              onClick={() => setMode('hide')}
            >
              {subject === 'contact' ? 'Hide Contact Details' : 'Hide Note'}
            </button>
          )}
        </div>
      )}
      <History subject={subject} versions={versions} current={current} ctx={ctx} />
      {mode && (
        <ChangeDialog
          subject={subject}
          mode={mode}
          chain={chain}
          versions={versions}
          current={current}
          ownerName={ownerName}
          ctx={ctx}
          close={() => setMode(null)}
        />
      )}
    </div>
  );
}

function Area({
  label,
  name,
  help,
  min,
  max,
  defaultValue = '',
  error,
}: {
  label: string;
  name: string;
  help: string;
  min: number;
  max: number;
  defaultValue?: string;
  error?: string;
}) {
  return (
    <label className="field">
      {label}
      <textarea
        name={name}
        required
        minLength={min}
        maxLength={max}
        defaultValue={defaultValue}
        aria-describedby={`${name}-help`}
        aria-invalid={error ? true : undefined}
      />
      <small id={`${name}-help`}>{help}</small>
      {error && <span role="alert">{error}</span>}
    </label>
  );
}

function Input({
  label,
  name,
  help,
  value,
  onChange,
  type = 'text',
  max = 1000,
  pattern,
  error,
  first = false,
}: {
  label: string;
  name: string;
  first?: boolean;
  help?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  max?: number;
  pattern?: string;
  error?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        required
        maxLength={max}
        pattern={pattern}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={help ? `${name}-help` : undefined}
        aria-invalid={error ? true : undefined}
        data-autofocus={first || undefined}
      />
      {help && <small id={`${name}-help`}>{help}</small>}
      {error && <span role="alert">{error}</span>}
    </label>
  );
}

function ChangeDialog({
  subject,
  mode,
  chain,
  versions,
  current,
  ownerName,
  ctx,
  close,
}: {
  subject: Subject;
  mode: Mode;
  chain: string;
  versions: ChangeRow[];
  current: ChangeRow;
  ownerName: string;
  ctx: ChangeContext;
  close: () => void;
}) {
  const contact = subject === 'contact';
  // The version the person saw when the dialog opened. After a conflict the page reloads, `current` becomes the newest
  // version, and the next save names it with a new command (U-02: they see both and choose).
  const [seen] = useState(current);
  const [conflict, setConflict] = useState(false);
  const usable = ['SOURCE_REPORTED', 'EXPIRED'].includes(String(current.status));
  const target = conflict && usable ? current : seen;
  const [locked, setLocked] = useState(false);
  const [alert, setAlert] = useState('');
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [refused, setRefused] = useState(false);
  const [resend, setResend] = useState(false);
  const [step, setStep] = useState(1);
  // Focus moves to the step heading on a step change, never on opening (the first field has it then).
  const [stepped, setStepped] = useState(false);
  const [discard, setDiscard] = useState(false);
  // Focus moves once per step change and once when the discard prompt opens, never on a keystroke.
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (stepped) stepHeading.current?.focus();
  }, [step, stepped]);
  useEffect(() => {
    if (discard) keepEditing.current?.focus();
  }, [discard]);
  const editable = (row: ChangeRow) => ({
    name: String(row.name ?? ''),
    jobTitle: String(row.job_title ?? ''),
    email: String(row.email ?? ''),
    body: String(row.body ?? ''),
    sourceId: String(row.source_id ?? ''),
    validUntil: String(row.valid_until ?? ''),
  });
  const [values, setValues] = useState(() => editable(current));
  const set = (key: keyof typeof values) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));
  // U-02: after a conflict the person's values are compared with the latest saved version, so the list names every
  // field that saving would overwrite, never a silent revert.
  const base = editable(conflict && usable ? current : seen);
  const same = (key: keyof typeof values) =>
    key === 'validUntil'
      ? new Date(values.validUntil).getTime() === new Date(base.validUntil).getTime()
      : values[key] === base[key];
  const changedFields = (
    contact
      ? ([
          ['name', 'Name'],
          ['jobTitle', 'Job title'],
          ['email', 'Email'],
          ['sourceId', 'Source'],
          ['validUntil', 'Valid until'],
        ] as const)
      : ([
          ['body', 'Note text'],
          ['sourceId', 'Source'],
        ] as const)
  ).filter(([key]) => !same(key));
  const edited = mode === 'correct' && changedFields.length > 0;
  const earlier = versions.filter((v) => v.id !== current.id).length;
  // Names the record as it was opened; once its chain is hidden, the words read Hidden, never null.
  const named = hidden(current) ? current : seen;
  const what = contact
    ? `${shown(named, 'name')}, ${shown(named, 'job_title')}`
    : `Private note from ${at(named.created_at)}: "${shown(named, 'body').slice(0, 80)}…"`;
  // Cancel and Discard Changes close the dialog by unmounting it, so focus goes back to the button that opened it, or
  // to the item when that button is gone.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  function leave() {
    close();
    setTimeout(() => {
      const back =
        opener && opener !== document.body && opener.isConnected
          ? opener
          : document.querySelector<HTMLElement>(`[data-chain="${chain}"]`);
      back?.focus();
    }, 0);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === 'correct' && contact && step === 1) {
      setStepped(true);
      setStep(2);
      return;
    }
    const form = new FormData(event.currentTarget);
    const reason = String(form.get('reason') ?? '');
    const id = { [contact ? 'contactId' : 'noteId']: target.id };
    const body: Record<string, unknown> =
      mode === 'withdraw'
        ? { action: `withdraw_${subject}`, ...id, reason }
        : mode === 'hide'
          ? {
              action: `redact_${subject}`,
              ...id,
              reason,
              ticketReference: String(form.get('ticketReference') ?? ''),
              confirmId: String(form.get('confirmId') ?? ''),
            }
          : contact
            ? {
                action: 'correct_contact',
                ...id,
                sourceId: values.sourceId,
                name: values.name,
                jobTitle: values.jobTitle,
                email: values.email,
                validUntil: new Date(values.validUntil).toISOString(),
                reason,
              }
            : {
                action: 'correct_note',
                ...id,
                sourceId: values.sourceId,
                body: values.body,
                reason,
              };
    setLocked(true);
    setAlert('');
    setFieldError({});
    try {
      await (mode === 'hide' ? withStepUp(() => ctx.send(body)) : ctx.send(body));
      close();
      await ctx.done(success[subject][mode], chain);
    } catch (error) {
      setResend(false);
      if (!(error instanceof ActionError) || error.status >= 500) {
        setAlert(
          'The change was not confirmed. Check your connection, then send the same request again.',
        );
        setResend(true);
      } else if (error.status === 429) {
        setAlert(limitWords);
        setResend(true);
      } else if (error.status === 401 && error.code !== 'STEP_UP_REQUIRED')
        setAlert('Your session has ended. Sign in again, then send the same request again.');
      else if (error.status === 403) {
        setAlert(error.message);
        setRefused(true);
      } else if (error.status === 404) {
        setAlert('This record is not available to you.');
        setRefused(true);
        void ctx.reload();
      } else if (error.code === 'CHANGED' || error.code === 'HIDDEN') {
        setConflict(true);
        await ctx.reload();
      } else if (error.code === 'CHANGES_UNAVAILABLE') {
        setAlert(error.message);
        setRefused(true);
      } else if (error.status === 400 && /id exactly/.test(error.message))
        setFieldError({ confirmId: `${error.message}.` });
      else setAlert(error.message);
    } finally {
      setLocked(false);
    }
  }
  // After a conflict the words follow the newest saved state of the chain.
  const conflictWords = !conflict
    ? ''
    : current.status === 'HIDDEN'
      ? contact
        ? "This contact's details were hidden after you opened it. Nothing was saved."
        : 'This note was hidden after you opened it. Nothing was saved.'
      : !usable
        ? `This ${subject} was withdrawn after you opened it. Nothing was saved.`
        : `Someone changed this ${subject} after you opened it. Nothing was saved. The latest saved details are shown below.${mode === 'correct' ? ' Your edits are kept.' : ''}`;
  const stopped = refused || (conflict && !usable);
  const safe = (
    <button
      type="button"
      className="button button-secondary"
      data-autofocus={mode === 'correct' ? undefined : true}
      disabled={locked}
      onClick={() => (edited ? setDiscard(true) : leave())}
    >
      {mode === 'correct' && step === 2 ? 'Back' : 'Cancel'}
    </button>
  );
  const confirmLabel = resend
    ? 'Send the Same Request Again'
    : mode === 'withdraw'
      ? 'Confirm Withdrawal'
      : mode === 'hide'
        ? 'Confirm and Hide'
        : contact && step === 1
          ? 'Next'
          : 'Save Correction';
  return (
    <Dialog
      open
      onClose={close}
      title={titles[subject][mode]}
      locked={locked}
      confirmClose={() => {
        if (!edited) return true;
        setDiscard(true);
        return false;
      }}
      returnFocusTo={() => document.querySelector<HTMLElement>(`[data-chain="${chain}"]`)}
    >
      <form onSubmit={submit} noValidate={false}>
        {conflict && usable && (
          <section>
            <h3>Latest saved details</h3>
            {contentLine(subject, current)}
          </section>
        )}
        {mode === 'withdraw' && (
          <>
            <p>{contact ? `${what}, on the relationship owned by ${ownerName}.` : what}</p>
            <p>
              {contact
                ? 'The contact stays in the history with your reason. It can no longer be chosen for new targets or messages. Existing mission targets keep it and show Withdrawn. This cannot be undone. To fix wrong details instead, use Correct Contact.'
                : 'The note stays in the history with your reason. People who can see this relationship can still read it. This cannot be undone. To fix the text instead, use Correct Note.'}
            </p>
            <Area
              label={`Why are you withdrawing this ${subject}?`}
              name="reason"
              help="3 to 500 characters. People who can see this relationship can read it."
              min={3}
              max={500}
            />
          </>
        )}
        {mode === 'correct' && (
          <>
            <p>
              A correction saves a new version. The current version stays in the history, marked
              Corrected, with your reason. Mission targets that use it keep using it.
            </p>
            {contact && (
              <h3 tabIndex={-1} ref={stepHeading}>
                {step === 1 ? 'Step 1 of 2: Contact details' : 'Step 2 of 2: Source and reason'}
              </h3>
            )}
            {contact && step === 1 && (
              <>
                <Input
                  label="Name"
                  name="name"
                  value={values.name}
                  onChange={set('name')}
                  first={!stepped}
                />
                <Input
                  label="Job title"
                  name="jobTitle"
                  value={values.jobTitle}
                  onChange={set('jobTitle')}
                />
                <Input
                  label="Email"
                  name="email"
                  type="email"
                  max={200}
                  value={values.email}
                  onChange={set('email')}
                  help={
                    ctx.purpose === 'synthetic_validation'
                      ? 'Sample workspaces accept only addresses ending in @example.invalid.'
                      : undefined
                  }
                />
              </>
            )}
            {(!contact || step === 2) && (
              <>
                {(contact || (conflict && usable)) && (
                  <p>
                    {changedFields.length
                      ? `You changed: ${changedFields.map(([, label]) => label).join(', ')}.`
                      : 'You changed nothing yet.'}
                  </p>
                )}
                <label className="field">
                  Source
                  <select
                    name="sourceId"
                    required
                    data-autofocus={!contact || undefined}
                    value={values.sourceId}
                    onChange={(e) => set('sourceId')(e.target.value)}
                    aria-describedby="source-help"
                  >
                    {ctx.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {String(s.locator ?? s.id)}
                      </option>
                    ))}
                  </select>
                  <small id="source-help">Choose a source that is still current.</small>
                </label>
                {contact ? (
                  <DateTimeInput
                    label="Valid until"
                    name="validUntil"
                    value={values.validUntil || null}
                    onChange={(iso) => set('validUntil')(iso ?? '')}
                    required
                  />
                ) : (
                  <label className="field">
                    Note text
                    <textarea
                      name="body"
                      required
                      minLength={1}
                      maxLength={2000}
                      value={values.body}
                      onChange={(e) => set('body')(e.target.value)}
                    />
                  </label>
                )}
                <Area
                  label={`Why are you correcting this ${subject}?`}
                  name="reason"
                  help={
                    contact
                      ? 'People who can see this relationship can read it.'
                      : '3 to 500 characters. People who can see this relationship can read it.'
                  }
                  min={3}
                  max={500}
                />
              </>
            )}
          </>
        )}
        {mode === 'hide' && (
          <>
            <p>
              {contact
                ? `${what}, ${shown(named, 'email')}, on the relationship owned by ${ownerName}.`
                : what}
              {earlier > 0 ? ` This includes ${earlier} earlier version(s).` : ''}
            </p>
            <h3>What happens</h3>
            <ol>
              <li>
                The record stays. Its text will be hidden from every screen and export in this
                workspace. This cannot be undone. Text already included in a message, and backups,
                are not changed.
              </li>
              <li>
                {contact
                  ? 'Hidden: the name, job title and email of this contact and of every version of it.'
                  : 'Hidden: the text of this note and of every version of it.'}
              </li>
              <li>
                What stays: the record, its id, its dates, who added and changed it, and its history
                entries. Mission targets and messages that used it stay and show Hidden.
              </li>
              {contact && (
                <li>
                  An opt-out already recorded for this address keeps working. New messages to this
                  contact are refused.
                </li>
              )}
              <li>Not covered: the relationship context written on the relationship itself.</li>
              <li>You may be asked for a fresh code from your authenticator app.</li>
            </ol>
            <Area
              label={
                contact ? 'Why are these details being hidden?' : 'Why is this note being hidden?'
              }
              name="reason"
              help="Workspace owners and admins can read this. Do not include personal details."
              min={10}
              max={500}
            />
            <TicketAndId subject={subject} id={target.id} error={fieldError.confirmId} />
          </>
        )}
        {(alert || conflictWords) && <p role="alert">{alert || conflictWords}</p>}
        {discard ? (
          <div role="group" aria-label="Discard changes">
            <p>Discard your changes to this {subject}?</p>
            <div className="ux-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                ref={keepEditing}
                data-autofocus
                onClick={() => setDiscard(false)}
              >
                Keep Editing
              </button>
              <button type="button" className="button button-secondary" onClick={leave}>
                Discard Changes
              </button>
            </div>
          </div>
        ) : (
          <div className="ux-dialog-actions">
            {mode === 'correct' && contact && step === 2 ? (
              <button
                type="button"
                className="button button-secondary"
                disabled={locked}
                onClick={() => {
                  setStepped(true);
                  setStep(1);
                }}
              >
                Back
              </button>
            ) : (
              safe
            )}
            <button
              type="submit"
              className={mode === 'correct' ? 'primary-link' : 'button button-secondary'}
              data-intent={mode === 'correct' ? undefined : 'destructive'}
              disabled={
                locked ||
                stopped ||
                (mode === 'correct' && (!contact || step === 2) && !edited && !resend)
              }
            >
              {confirmLabel}
            </button>
          </div>
        )}
        {mode === 'correct' && (!contact || step === 2) && !edited && (
          <p>Change at least one detail to save a correction.</p>
        )}
      </form>
    </Dialog>
  );
}

function TicketAndId({ subject, id, error }: { subject: Subject; id: string; error?: string }) {
  const [ticket, setTicket] = useState('');
  const [typed, setTyped] = useState('');
  return (
    <>
      <Input
        label="Ticket reference"
        name="ticketReference"
        value={ticket}
        onChange={setTicket}
        max={64}
        pattern="[A-Za-z0-9][A-Za-z0-9._:/#-]{2,63}"
        help="The reference of the request you are acting on, for example REQ-2026-0142. Use 3 to 64 letters, numbers or . _ : / # - with no spaces and no @."
      />
      <p>
        {subject === 'contact' ? 'Contact id' : 'Note id'}: <code>{id}</code>
      </p>
      <Input
        label={`Type the ${subject} id to confirm`}
        name="confirmId"
        value={typed}
        onChange={setTyped}
        max={64}
        error={error}
      />
    </>
  );
}
