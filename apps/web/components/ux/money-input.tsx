'use client';
// One money field (D10). People type major units ("100.50"); the value stays exact minor units
// ("10050") and is never a float. A live preview reads "USD 100.50". Owner after Wave 0: WS-E.
import './ux-kit.css';
import { useId, useState } from 'react';
import { currencyExponent, formatMoney, toMajorText, toMinor } from '../../lib/ux/money';

export type MoneyInputProps = {
  label: string;
  currency: string;
  /** Exact minor units as a string, or null when empty. */
  value: string | null;
  onChange: (minor: string | null) => void;
  name?: string;
  id?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
};

export function MoneyInput({
  label,
  currency,
  value,
  onChange,
  name,
  id,
  hint,
  error,
  required,
  disabled,
}: MoneyInputProps) {
  const generated = useId();
  const inputId = id ?? `${generated}-input`;
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  let places = 2;
  try {
    places = currencyExponent(currency);
  } catch {
    places = 2;
  }
  const shown = text ?? toMajorText(value, currency);
  const message = error || problem;
  const preview = value !== null && value !== '' ? safeFormat(value, currency) : '';
  const describedBy = [
    `${generated}-preview`,
    hint ? `${generated}-hint` : '',
    message ? `${generated}-error` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="ux-kit-field">
      <label className="ux-kit-label" htmlFor={inputId}>
        {label} ({currency}){required ? <span className="ux-kit-hint"> (required)</span> : null}
      </label>
      {hint ? (
        <p className="ux-kit-hint" id={`${generated}-hint`}>
          {hint}
        </p>
      ) : null}
      <input
        id={inputId}
        className="ux-kit-input"
        inputMode={places ? 'decimal' : 'numeric'}
        autoComplete="off"
        disabled={disabled}
        required={required}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy}
        placeholder={places ? `0.${'0'.repeat(places)}` : '0'}
        value={shown}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next.trim()) {
            setProblem('');
            onChange(null);
            return;
          }
          try {
            onChange(toMinor(next, currency));
            setProblem('');
          } catch (e) {
            setProblem(
              places
                ? `Enter an amount like 100 or 100.${'5'.padEnd(places, '0')}. ${currency} uses ${places} decimal places.`
                : `Enter a whole amount. ${currency} has no decimal places.`,
            );
            void e;
          }
        }}
        onBlur={() => setText(null)}
      />
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      <p className="ux-kit-preview" id={`${generated}-preview`} aria-live="polite">
        {preview ? `Amount: ${preview}` : ''}
      </p>
      {message ? (
        <p className="ux-kit-error" id={`${generated}-error`} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function safeFormat(minor: string, currency: string) {
  try {
    return formatMoney(minor, currency);
  } catch {
    return '';
  }
}
