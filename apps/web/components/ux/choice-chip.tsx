'use client';

import { useId, type ReactNode } from 'react';
import './choice-chip.css';

// Choice chips: one radio of a small set drawn as a chip (board 3c: market, steps, currency, the brief's answers).
// The native radio keeps the state, the arrow keys and the name; the chip is its label, at least 44 px high.
export function ChoiceChip({
  name,
  value,
  checked,
  onChoose,
  label,
  id,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChoose: () => void;
  label: ReactNode;
  /** A stable id, when a test or a label needs one; otherwise one is made. */
  id?: string;
}) {
  const made = useId();
  const inputId = id ?? made;
  return (
    <span className="ux-chip">
      <input
        className="sr-only"
        type="radio"
        name={name}
        id={inputId}
        value={value}
        checked={checked}
        onChange={onChoose}
      />
      <label htmlFor={inputId}>{label}</label>
    </span>
  );
}

/** The row the chips of one question sit in. */
export function ChoiceChipRow({ children }: { children: ReactNode }) {
  return <div className="ux-chip-row">{children}</div>;
}
