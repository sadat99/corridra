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
  /** The text and whether the browser could not read it as a number (validity.badInput, such as "12a"). */
  onChange: (value: string, unreadable: boolean) => void;
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
        // onInput as well as onChange: a number field that goes from unreadable ("2e") to empty keeps the value "",
        // so only the raw input event says the text is readable again.
        onChange={(event) => onChange(event.target.value, event.target.validity?.badInput === true)}
        onInput={(event) =>
          onChange(event.currentTarget.value, event.currentTarget.validity?.badInput === true)
        }
      />
      <p className="ux-number-error" id={`${id}-error`} aria-live="polite">
        {error ?? null}
      </p>
    </div>
  );
}
