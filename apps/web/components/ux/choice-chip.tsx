'use client';

import { useId, type ReactNode } from 'react';
import { CorridraIcon } from '../corridra-icon';
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

// Choice row (Wave 3 unit 08): the answers of one question as large, full-word rows, 64 px on a phone and 72 px from 768
// px. Each row is a button that acts at once (it does not hold a radio state), so a screen reads them as a named group.
// Words wrap and are never cut; no width is fixed. Keep the row out of `.reply-actions` and other button rows.
export function ChoiceRow({
  labelledBy,
  children,
}: {
  /** The id of the heading that asks the question; the group takes its name from it. */
  labelledBy: string;
  children: ReactNode;
}) {
  return (
    <div className="ux-choice-row" role="group" aria-labelledby={labelledBy}>
      {children}
    </div>
  );
}

export function ChoiceButton({
  onClick,
  disabled,
  variant = 'secondary',
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** Primary for the answer the page leads with, secondary for the rest. */
  variant?: 'primary' | 'secondary';
  /** An existing icon name, drawn beside the words and hidden from a screen reader. */
  icon?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`ux-choice ux-choice-${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <CorridraIcon name={icon} />}
      <span>{children}</span>
    </button>
  );
}
