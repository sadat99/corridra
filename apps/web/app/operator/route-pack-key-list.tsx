'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { FieldError } from '../../components/field-error';
import { keyIssue } from '../../lib/route-pack-editor-pack';
import {
  keyAdded,
  keyCount,
  keyIssueWords,
  keyRemoved,
  packWords,
  removeKey,
} from '../../lib/route-pack-editor-pack-words';
import './route-pack-pack.css';

// ADR-093 Phase 3, PR 3b: one of the seven key lists, typed in one key at a time (spec 8.9). The key stays as typed (trimmed),
// in the order added. The empty issue shows only after Add is pressed with nothing typed; the others show as typed.

type FocusTarget = { kind: 'input' } | { kind: 'remove'; index: number };

export function KeyListEntry({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [typed, setTyped] = useState('');
  const [pressedEmpty, setPressedEmpty] = useState(false);
  const [announce, setAnnounce] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const removes = useRef<(HTMLButtonElement | null)[]>([]);
  const focusAfter = useRef<FocusTarget | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = null;
    (target.kind === 'input' ? input.current : removes.current[target.index])?.focus();
  });

  const found = keyIssue(typed, value);
  const issue = found && (found.kind !== 'empty' || pressedEmpty) ? found : null;
  const full = found?.kind === 'full';
  const blocked = !!found && found.kind !== 'empty';
  const errorId = `${id}-error`;

  const add = () => {
    const issueNow = keyIssue(typed, value);
    if (issueNow?.kind === 'empty') {
      setPressedEmpty(true);
      input.current?.focus();
      return;
    }
    if (issueNow) return;
    const key = typed.trim();
    onChange([...value, key]);
    setAnnounce(keyAdded(key, value.length + 1));
    setTyped('');
    setPressedEmpty(false);
    focusAfter.current = { kind: 'input' };
  };
  const remove = (index: number) => {
    const key = value[index];
    onChange(value.filter((_, at) => at !== index));
    setAnnounce(keyRemoved(key, value.length - 1));
    focusAfter.current =
      index < value.length - 1
        ? { kind: 'remove', index }
        : index > 0
          ? { kind: 'remove', index: index - 1 }
          : { kind: 'input' };
  };

  return (
    <div role="group" aria-label={label} className="route-edit-list route-pack-keys">
      <p className="sr-only" role="status">
        {announce}
      </p>
      {value.length ? (
        <ul className="route-pack-key-rows" dir="ltr">
          {value.map((key, index) => (
            <li key={key} className="route-pack-key-row">
              <span className="route-pack-key">{key}</span>
              <button
                type="button"
                className="text-link"
                aria-label={removeKey(key)}
                ref={(node) => {
                  removes.current[index] = node;
                }}
                onClick={() => remove(index)}
              >
                {packWords.remove}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="route-edit-quiet">{packWords.emptyList}</p>
      )}
      <div className="route-edit-entry route-pack-key-entry">
        <div className="field route-edit-field">
          <label htmlFor={`${id}-input`}>{packWords.addKeyLabel}</label>
          <input
            id={`${id}-input`}
            ref={input}
            dir="ltr"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={typed}
            aria-invalid={issue ? true : undefined}
            aria-describedby={issue ? errorId : undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              if (event.target.value.trim()) setPressedEmpty(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add();
            }}
          />
        </div>
        <button
          type="button"
          className="button-secondary route-pack-add"
          disabled={blocked}
          aria-describedby={full ? errorId : undefined}
          onClick={add}
        >
          {packWords.addKey}
        </button>
      </div>
      {issue ? <FieldError id={errorId}>{keyIssueWords(issue)}</FieldError> : null}
      <p className="route-edit-count">{keyCount(value.length)}</p>
    </div>
  );
}
