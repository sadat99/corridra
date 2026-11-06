'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { formEn } from '../../../lib/i18n/form-words/en';

// Rename, archive and restore one programme (CRUD gap G7). The database owns every rule; this only asks and shows the answer.
export type LifecycleProgramme = {
  id: string;
  name: string;
  reportingPurpose: string;
  archived: boolean;
  version: number;
};
export type LifecycleChange = LifecycleProgramme & { operation: 'rename' | 'archive' | 'restore' };
type Outcome =
  | { ok: true; result: LifecycleChange }
  | { ok: false; kind: 'denied' | 'stale' | 'refused' | 'limited' | 'failed'; message: string };
type Request = {
  workspaceId: string;
  headers: Record<string, string>;
  programme: LifecycleProgramme;
  operation: 'rename' | 'archive' | 'restore';
  name?: string;
  reportingPurpose?: string;
  commandId: string;
};

export async function changeProgramme(request: Request): Promise<Outcome> {
  try {
    const response = await fetch('/api/customer-programme-lifecycle', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { ...request.headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: request.operation,
        commandId: request.commandId,
        workspaceId: request.workspaceId,
        programmeId: request.programme.id,
        expectedVersion: request.programme.version,
        ...(request.operation === 'rename'
          ? { name: request.name, reportingPurpose: request.reportingPurpose }
          : {}),
      }),
    });
    if ([401, 403].includes(response.status))
      return {
        ok: false,
        kind: 'denied',
        message: 'Only a workspace owner or admin can change a programme.',
      };
    if (response.status === 429)
      return {
        ok: false,
        kind: 'limited',
        message: formEn['form.message.tooMany'],
      };
    if (response.status === 503)
      return {
        ok: false,
        kind: 'failed',
        message: 'Renaming and archiving programmes is not available yet.',
      };
    if (response.status === 409) {
      const text = String(
        ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? '',
      );
      return text.startsWith('Programme changed')
        ? {
            ok: false,
            kind: 'stale',
            message:
              'This programme was changed by someone else. The latest version is shown; try again.',
          }
        : {
            ok: false,
            kind: 'refused',
            message: text.startsWith('The request conflicts')
              ? 'This change could not be made. Reload the page and try again.'
              : text === 'Programme name and reporting purpose required'
                ? 'The name or the purpose is not allowed. A name cannot contain tabs or line breaks, and both must keep their length limits.'
                : text,
          };
    }
    if (!response.ok) throw Error('Programme change failed');
    const data = (await response.json()) as Partial<LifecycleChange>;
    if (
      data.id !== request.programme.id ||
      typeof data.name !== 'string' ||
      typeof data.reportingPurpose !== 'string' ||
      typeof data.archived !== 'boolean' ||
      typeof data.version !== 'number' ||
      data.operation !== request.operation
    )
      throw Error('Unconfirmed programme change');
    return { ok: true, result: data as LifecycleChange };
  } catch {
    return {
      ok: false,
      kind: 'failed',
      message: 'The change could not be confirmed. Try again; nothing is changed twice.',
    };
  }
}

export function ProgrammeLifecycle({
  programme,
  workspaceId,
  headers,
  onChanged,
  onStale,
}: {
  programme: LifecycleProgramme;
  workspaceId: string;
  headers: Record<string, string>;
  onChanged: (change: LifecycleChange, before: LifecycleProgramme) => void;
  // A stale rename keeps the person's text and asks them to choose (null); any other stale answer comes back as words for the page.
  onStale: (message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(programme.name);
  const [purpose, setPurpose] = useState(programme.reportingPurpose);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [discarding, setDiscarding] = useState(false);
  // What the person saw when Rename opened. Saving always sends this version, never a newer one a reload brought in, so a
  // colleague's change is shown as a choice (Keep Mine / Use Theirs) and never overwritten silently.
  const [base, setBase] = useState<{ version: number; name: string; purpose: string } | null>(null);
  // The server said the version was stale; kept until the person chooses, even while the latest version is still loading.
  const [serverStale, setServerStale] = useState(false);
  // One command id per exact attempt: pressing again after a lost answer repeats the same command and changes nothing twice.
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  // Focus moves into the form when it opens and back to the Rename button when it closes (A-03).
  const nameField = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) nameField.current?.focus();
    else if (wasEditing.current) renameButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const trimmed = { name: name.trim(), purpose: purpose.trim() };
  const changed = trimmed.name !== programme.name || trimmed.purpose !== programme.reportingPurpose;
  // Typed text that differs from what the person started with (not from a newer version that arrived meanwhile).
  const dirty = base !== null && (trimmed.name !== base.name || trimmed.purpose !== base.purpose);
  // The database refuses control characters in the name (a tab or line break inside it); say so before it is sent.
  const nameBad = /\p{Cc}/u.test(trimmed.name);
  const purposeBad = /[^\P{Cc}\t\n\r]/u.test(trimmed.purpose);
  const valid =
    trimmed.name.length >= 3 &&
    trimmed.name.length <= 160 &&
    trimmed.purpose.length >= 10 &&
    trimmed.purpose.length <= 500 &&
    !nameBad &&
    !purposeBad;
  const newerShown = base !== null && programme.version !== base.version;
  const conflict = editing && !programme.archived && base !== null && (serverStale || newerShown);
  async function run(operation: 'rename' | 'archive' | 'restore', expectedVersion?: number) {
    if (busy) return;
    const sent =
      expectedVersion ?? (operation === 'rename' && base ? base.version : programme.version);
    const signature = JSON.stringify([operation, sent, trimmed.name, trimmed.purpose]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setNote('');
    const outcome = await changeProgramme({
      workspaceId,
      headers,
      programme: { ...programme, version: sent },
      operation,
      ...(operation === 'rename' ? { name: trimmed.name, reportingPurpose: trimmed.purpose } : {}),
      commandId: attempt.current.id,
    });
    setBusy(false);
    if (outcome.ok) {
      attempt.current = null;
      // A rename ends the editing; a restore done from inside the form keeps the typed text so it can still be saved.
      if (operation === 'rename') {
        setEditing(false);
        setDiscarding(false);
        setBase(null);
        setServerStale(false);
      }
      onChanged(outcome.result, programme);
      return;
    }
    // A stale answer reloads the list. This component stays mounted, so a stale rename keeps what was typed and offers the choice;
    // any other stale answer is told by the page, which outlives the reload.
    if (outcome.kind === 'stale') {
      attempt.current = null;
      if (operation === 'rename') {
        setServerStale(true);
        onStale(null);
      } else onStale(outcome.message);
      return;
    }
    setNote(outcome.message);
  }
  function close() {
    setEditing(false);
    setDiscarding(false);
    setBase(null);
    setServerStale(false);
    setName(programme.name);
    setPurpose(programme.reportingPurpose);
    setNote('');
  }
  function cancel() {
    if (dirty && !discarding) setDiscarding(true);
    else close();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (changed && valid && !conflict) void run('rename');
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }
  return (
    <div className="programme-lifecycle">
      {!editing && (
        <p>
          {programme.archived ? (
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => void run('restore')}
            >
              Restore Programme
            </button>
          ) : (
            <>
              <button
                ref={renameButton}
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => {
                  setName(programme.name);
                  setPurpose(programme.reportingPurpose);
                  setBase({
                    version: programme.version,
                    name: programme.name,
                    purpose: programme.reportingPurpose,
                  });
                  setServerStale(false);
                  setEditing(true);
                }}
              >
                Rename Programme
              </button>{' '}
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => void run('archive')}
              >
                Archive Programme
              </button>
            </>
          )}
        </p>
      )}
      {editing && (
        <form onSubmit={submit} onKeyDown={keys} aria-label="Rename programme">
          <label className="field">
            New programme name
            <input
              ref={nameField}
              value={name}
              maxLength={160}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            New reporting purpose
            <textarea
              value={purpose}
              maxLength={500}
              rows={3}
              disabled={busy}
              onChange={(event) => setPurpose(event.target.value)}
            />
          </label>
          <p>
            <button
              className="primary-link"
              disabled={busy || !changed || !valid || conflict || programme.archived}
            >
              Save Changes
            </button>{' '}
            <button type="button" className="text-link" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </p>
          {programme.archived && (
            <div role="alert">
              <p>
                This programme was archived while you were editing. Restore it to rename it, or
                discard your text.{' '}
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={() => void run('restore')}
                >
                  Restore Programme
                </button>{' '}
                <button type="button" className="text-link" onClick={close}>
                  Discard Changes
                </button>
              </p>
            </div>
          )}
          {(nameBad || purposeBad) && (
            <p role="alert">
              {nameBad
                ? 'The name cannot contain tabs or line breaks.'
                : 'The purpose contains a character that is not allowed.'}
            </p>
          )}
          {conflict && (
            <div role="alert">
              {newerShown ? (
                <>
                  <p>Someone else changed this programme first. It now reads:</p>
                  <p>
                    <strong>{programme.name}</strong>
                  </p>
                  <p>{programme.reportingPurpose}</p>
                  <p>
                    Your text is still in the form.{' '}
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy || !dirty || !valid}
                      onClick={() => {
                        const latest = programme.version;
                        setBase(base && { ...base, version: latest });
                        setServerStale(false);
                        void run('rename', latest);
                      }}
                    >
                      Keep Mine
                    </button>{' '}
                    <button type="button" className="text-link" onClick={close}>
                      Use Theirs
                    </button>
                  </p>
                </>
              ) : (
                <p>
                  Someone else changed this programme first. Checking the latest version…{' '}
                  <button type="button" className="text-link" onClick={() => onStale(null)}>
                    Check Again
                  </button>
                </p>
              )}
            </div>
          )}
          {discarding && (
            <p role="alert">
              Discard your changes?{' '}
              <button type="button" className="text-link" onClick={close}>
                Discard Changes
              </button>{' '}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setDiscarding(false);
                  nameField.current?.focus();
                }}
              >
                Keep Editing
              </button>
            </p>
          )}
        </form>
      )}
      {note && <p role="alert">{note}</p>}
    </div>
  );
}
