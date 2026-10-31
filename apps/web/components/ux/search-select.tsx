'use client';
// Searchable single-choice picker (ARIA 1.2 combobox with a listbox popup). No dependency: the
// repository had no combobox primitive, and this one covers the program's needs (W0.6).
// Labels are names, never codes. A hidden input carries the value for plain form posts.
// Owner after Wave 0: WS-E (internals only; props are fixed).
import './ux-kit.css';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { PickerOption } from '../../lib/ux/options';

export type SearchSelectProps = {
  label: string;
  options: PickerOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Values shown first, above a divider, when the search box is empty. */
  pinned?: readonly string[];
  name?: string;
  id?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Called when the search text changes (ReferencePicker uses it to load options). */
  onQuery?: (query: string) => void;
  emptyText?: string;
};

function normalise(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

export function SearchSelect({
  label,
  options,
  value,
  onChange,
  pinned = [],
  name,
  id,
  hint,
  error,
  required,
  disabled,
  placeholder = 'Type to search',
  onQuery,
  emptyText = 'No matches. Try another word.',
}: SearchSelectProps) {
  const generated = useId();
  const inputId = id ?? `${generated}-input`;
  const listId = `${generated}-list`;
  const hintId = hint ? `${generated}-hint` : undefined;
  const errorId = error ? `${generated}-error` : undefined;
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const text = query === null ? '' : normalise(query.trim());
    if (!text) {
      const pinnedSet = new Set(pinned);
      const first = pinned
        .map((p) => options.find((o) => o.value === p))
        .filter((o): o is PickerOption => Boolean(o));
      return {
        items: [...first, ...options.filter((o) => !pinnedSet.has(o.value))],
        split: first.length,
      };
    }
    return {
      items: options.filter(
        (o) =>
          normalise(o.label).includes(text) ||
          normalise(o.hint ?? '').includes(text) ||
          normalise(o.value) === text,
      ),
      split: 0,
    };
  }, [options, pinned, query]);

  function choose(option: PickerOption | null) {
    onChange(option ? option.value : null);
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(visible.items.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option = visible.items[active];
      if (option) choose(option);
    } else if (event.key === 'Escape') {
      setQuery(null);
      setOpen(false);
    } else if (event.key === 'Home' && open) {
      setActive(0);
    } else if (event.key === 'End' && open) {
      setActive(Math.max(visible.items.length - 1, 0));
    }
  }

  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ux-kit-field">
      <label className="ux-kit-label" htmlFor={inputId}>
        {label}
        {required ? <span className="ux-kit-hint"> (required)</span> : null}
      </label>
      {hint ? (
        <p className="ux-kit-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className="ux-kit-combo">
        <input
          ref={input}
          id={inputId}
          className="ux-kit-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visible.items[active] ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={query ?? selected?.label ?? ''}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
            onQuery?.(event.target.value);
            if (!event.target.value) onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Leave time for a pointer choice; keep the chosen label otherwise.
            window.setTimeout(() => {
              setOpen(false);
              setQuery(null);
            }, 120);
          }}
          onKeyDown={onKeyDown}
        />
        {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
        {open && !disabled ? (
          <ul className="ux-kit-listbox" id={listId} role="listbox" aria-label={label}>
            {visible.items.length === 0 ? (
              <li className="ux-kit-option" role="option" aria-selected={false} aria-disabled>
                {emptyText}
              </li>
            ) : (
              visible.items.slice(0, 200).map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  className="ux-kit-option"
                  aria-selected={option.value === value}
                  data-active={index === active}
                  style={
                    visible.split && index === visible.split
                      ? { borderTop: '1px solid var(--ac-border)' }
                      : undefined
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span>{option.label}</span>
                  {option.hint ? <span className="ux-kit-option-hint">{option.hint}</span> : null}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
      {error ? (
        <p className="ux-kit-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
