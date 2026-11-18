'use client';

import './number-field.css';

// A number field with its label, an optional unit beside the label, and its error under it (board 3c calculator).
// The error is tied to the field by aria-describedby and the field says aria-invalid while it shows.
export function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  whole = false,
  error,
}: {
  id: string;
  label: string;
  /** The unit every amount is read in, such as a currency code. */
  unit?: string;
  value: string;
  onChange: (value: string) => void;
  /** Whole numbers only (people, days, meetings). */
  whole?: boolean;
  error?: string | null;
}) {
  return (
    <div className="ux-number-field">
      <label htmlFor={id}>
        {label}
        {unit ? <span> ({unit})</span> : null}
      </label>
      <input
        id={id}
        type="number"
        inputMode={whole ? 'numeric' : 'decimal'}
        min={0}
        step={whole ? 1 : 'any'}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-error`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="ux-number-error" id={`${id}-error`} aria-live="polite">
        {error ?? null}
      </p>
    </div>
  );
}
