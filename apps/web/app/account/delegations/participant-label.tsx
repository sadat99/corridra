'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';

// Correct a participant's display label (CRUD gap G7, module 2). The participant corrects their own; an owner or admin may correct
// it from the organiser list. The database owns every rule; this asks and shows the answer. Consent is never changed here.
export function ParticipantLabelEditor({
  registrationId,
  label,
  version,
  headers,
  mine,
  onChanged,
  onNote,
}: {
  registrationId: string;
  label: string;
  version: number;
  headers: Record<string, string>;
  mine: boolean;
  onChanged: () => void;
  // A reload replaces the whole list, which remounts this editor: the words after a reload are kept by the page, not here.
  onNote: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (editing) field.current?.focus();
    else if (wasEditing.current) opener.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const trimmed = value.trim();
  const changed = trimmed !== label;
  const valid =
    trimmed.length >= 2 &&
    trimmed.length <= 120 &&
    customerLabelAllowed(trimmed) &&
    !/[\u0000-\u001f\u007f]/u.test(trimmed);
  function close() {
    setEditing(false);
    setDiscarding(false);
    setValue(label);
    setNote('');
  }
  function cancel() {
    if (changed && !discarding) setDiscarding(true);
    else close();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !changed || !valid) return;
    const signature = JSON.stringify([registrationId, version, trimmed]);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    setBusy(true);
    setNote('');
    try {
      const response = await fetch('/api/customer-programme-participants', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'label',
          commandId: attempt.current.id,
          registrationId,
          expectedVersion: version,
          displayLabel: trimmed,
        }),
      });
      if ([401, 403].includes(response.status)) {
        setNote(
          mine
            ? 'Your registration could not be changed.'
            : 'Only a workspace owner or admin can change a participant label.',
        );
      } else if (response.status === 503) {
        setNote('Changing labels is not available yet.');
      } else if (response.status === 409) {
        const text = String(
          ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? '',
        );
        attempt.current = null;
        if (text.startsWith('Label changed')) {
          setEditing(false);
          onNote('This label was changed by someone else. The latest version is shown; try again.');
          onChanged();
        } else {
          setNote(
            text === 'Nothing changed'
              ? 'The label is already this.'
              : 'This change could not be made. Reload the page and try again.',
          );
        }
      } else if (!response.ok) {
        throw Error('Label change failed');
      } else {
        const data = (await response.json()) as { registrationId?: string; displayLabel?: string };
        if (data.registrationId !== registrationId || data.displayLabel !== trimmed)
          throw Error('Unconfirmed label change');
        attempt.current = null;
        setEditing(false);
        setDiscarding(false);
        onNote('');
        onChanged();
      }
    } catch {
      setNote('The change could not be confirmed. Try again; nothing is changed twice.');
    } finally {
      setBusy(false);
    }
  }
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  }
  return (
    <div className="programme-label">
      {!editing && (
        <p>
          <button
            ref={opener}
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => {
              setValue(label);
              setEditing(true);
            }}
          >
            {mine ? 'Edit My Label' : 'Edit Label'}
          </button>
        </p>
      )}
      {editing && (
        <form onSubmit={(event) => void save(event)} onKeyDown={keys} aria-label="Change label">
          <label className="field">
            New display label
            <input
              ref={field}
              value={value}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <p>
            <button className="primary-link" disabled={busy || !changed || !valid}>
              Save Label
            </button>{' '}
            <button type="button" className="text-link" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </p>
          {discarding && (
            <p role="alert">
              Discard your change?{' '}
              <button type="button" className="text-link" onClick={close}>
                Discard Change
              </button>{' '}
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setDiscarding(false);
                  field.current?.focus();
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
