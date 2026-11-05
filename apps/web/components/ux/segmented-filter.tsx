'use client';
import { useId } from 'react';
import './segmented-filter.css';

export type SegmentOption<T extends string> = { value: T; label: string; count?: number };

/**
 * A radio group drawn as joined segments. It applies at once (no submit button), the arrow keys move
 * between segments as they do for any radio group, and counts use tabular numerals. The caller decides
 * what a change does (a client filter, or a new address).
 */
export function SegmentedFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
}) {
  const name = `seg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <fieldset className="ux-segments">
      <legend>{label}</legend>
      <div className="ux-segments-row">
        {options.map((option) => (
          <label key={option.value} className="ux-segment">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>
              {option.label}
              {option.count === undefined ? null : (
                <span className="ux-segment-count"> {option.count}</span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
