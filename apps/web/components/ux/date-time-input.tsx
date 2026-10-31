'use client';
// Date and time field that always shows its time zone (D9, D11). The value is an exact ISO instant;
// the person types the wall-clock time in the shown zone. Owner after Wave 0: WS-E.
import './ux-kit.css';
import { useId } from 'react';
import {
  isoToZonedWallTime,
  resolveTimeZone,
  timeZoneLabel,
  zonedWallTimeToIso,
} from '../../lib/ux/format';

export type DateTimeInputProps = {
  label: string;
  /** Exact instant as an ISO string, or null when empty. */
  value: string | null;
  onChange: (iso: string | null) => void;
  /** IANA zone the person types in. Defaults to the viewer's zone. */
  timeZone?: string;
  name?: string;
  id?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
};

export function DateTimeInput({
  label,
  value,
  onChange,
  timeZone,
  name,
  id,
  hint,
  error,
  required,
  disabled,
  min,
}: DateTimeInputProps) {
  const generated = useId();
  const inputId = id ?? `${generated}-input`;
  const zone = resolveTimeZone(timeZone);
  const zoneText = timeZoneLabel(zone, value ? new Date(value) : new Date());
  const describedBy = [
    `${generated}-zone`,
    hint ? `${generated}-hint` : '',
    error ? `${generated}-error` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="ux-kit-field">
      <label className="ux-kit-label" htmlFor={inputId}>
        {label}
        {required ? <span className="ux-kit-hint"> (required)</span> : null}
      </label>
      {hint ? (
        <p className="ux-kit-hint" id={`${generated}-hint`}>
          {hint}
        </p>
      ) : null}
      <div className="ux-kit-row">
        <input
          id={inputId}
          type="datetime-local"
          className="ux-kit-input"
          disabled={disabled}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          min={min ? isoToZonedWallTime(min, zone) : undefined}
          value={value ? isoToZonedWallTime(value, zone) : ''}
          onChange={(event) => onChange(zonedWallTimeToIso(event.target.value, zone))}
        />
        <span className="ux-kit-zone" id={`${generated}-zone`}>
          Time zone: {zoneText}
        </span>
      </div>
      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      {error ? (
        <p className="ux-kit-error" id={`${generated}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
