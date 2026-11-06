'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { customerLabelAllowed } from '@corridra/domain/customer-input-mode';
import { formEn } from '../../../lib/i18n/form-words/en';

// What a person has typed into a label correction, and the version of the label they started from. A reload of the list
// remounts the editor, so the draft lives here, in memory only, and is dropped the moment the page is hidden or left.
type Draft = { value: string; base: { version: number; label: string }; stale: boolean };
const drafts = new Map<string, Draft>();
if (typeof window !== 'undefined') {
  const dropAll = () => drafts.clear();
  window.addEventListener('pagehide', dropAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') dropAll();
  });
}

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
  const key = JSON.stringify([
    headers['x-corridra-customer-issuer'],
    headers['x-corridra-customer-subject'],
    registrationId,
  ]);
  const [draft, setDraftState] = useState<Draft | null>(() => drafts.get(key) ?? null);
  const setDraft = (next: Draft | null) => {
    if (next) drafts.set(key, next);
    else drafts.delete(key);
    setDraftState(next);
  };
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) field.current?.focus();
    else if (wasEditing.current) opener.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const trimmed = (draft?.value ?? label).trim();
  const changed = trimmed !== label;
  // Typed text that differs from what the person started with, not from a newer label that arrived meanwhile.
  const dirty = draft !== null && trimmed !== draft.base.label;
  const valid =
    trimmed.length >= 2 &&
    trimmed.length <= 120 &&
    customerLabelAllowed(trimmed) &&
    !/\p{Cc}/u.test(trimmed);
  const newerShown = draft !== null && version !== draft.base.version;
  // Saving always uses the version the person started from. A newer one, or a stale answer, shows a choice first.
  const conflict = draft !== null && (draft.stale || newerShown);
  function close() {
    setDraft(null);
    setDiscarding(false);
    setNote('');
  }
  function cancel() {
    if (dirty && !discarding) setDiscarding(true);
    else close();
  }
  async function save(event?: FormEvent, expectedVersion?: number) {
    event?.preventDefault();
    if (busy || !draft || !changed || !valid || (conflict && expectedVersion === undefined)) return;
    const sent = expectedVersion ?? draft.base.version;
    const signature = JSON.stringify([registrationId, sent, trimmed]);
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
          expectedVersion: sent,
          displayLabel: trimmed,
        }),
      });
      if ([401, 403].includes(response.status)) {
        setNote(
          mine
            ? 'Your registration could not be changed.'
            : 'Only a workspace owner or admin can change a participant label.',
        );
      } else if (response.status === 429) {
        setNote(formEn['form.message.tooMany']);
      } else if (response.status === 503) {
        setNote('Changing labels is not available yet.');
      } else if (response.status === 409) {
        const text = String(
          ((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? '',
        );
        attempt.current = null;
        if (text.startsWith('Label changed')) {
          // Keep what was typed and show the newer label as a choice; the reload brings it in.
          setDraft({ ...draft, stale: true });
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
        setDraft(null);
        setDiscarding(false);
        onNote('Label saved.');
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
              onNote('');
              setDraft({ value: label, base: { version, label }, stale: false });
            }}
          >
            {mine ? 'Edit My Label' : 'Edit Label'}
          </button>
        </p>
      )}
      {draft && (
        <form onSubmit={(event) => void save(event)} onKeyDown={keys} aria-label="Change label">
          <label className="field">
            New display label
            <input
              ref={field}
              value={draft.value}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            />
          </label>
          <p>
            <button className="primary-link" disabled={busy || !changed || !valid || conflict}>
              Save Label
            </button>{' '}
            <button type="button" className="text-link" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </p>
          {conflict && (
            <div role="alert">
              {newerShown ? (
                <>
                  <p>This label was changed by someone else. It now reads:</p>
                  <p>
                    <strong>{label}</strong>
                  </p>
                  <p>
                    Your text is still in the form.{' '}
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy || !dirty || !valid}
                      onClick={() => {
                        const latest = version;
                        setDraft({ ...draft, base: { version: latest, label }, stale: false });
                        void save(undefined, latest);
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
                  This label was changed by someone else. Checking the latest version…{' '}
                  <button type="button" className="text-link" onClick={() => onChanged()}>
                    Check Again
                  </button>
                </p>
              )}
            </div>
          )}
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
