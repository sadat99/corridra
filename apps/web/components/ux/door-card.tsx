'use client';

import { useId, type ReactNode } from 'react';
import { CorridraIcon } from '../corridra-icon';
import './door-card.css';

// A door: one choice of a radio group drawn as a card (board 3c hero; reused by the access, plan and routes units).
// The native radio carries the state and the keyboard; the card is its label, so the whole card is the target and
// its words are the radio's accessible name. Big doors add a side line and a route line above the title.
// UI/UX.v4.1 (L2, L3) adds two optional props, `icon` and `tone`; a door given neither is unchanged.
export function DoorCard({
  name,
  value,
  checked,
  onChoose,
  title,
  text,
  side,
  route,
  picked,
  size = 'small',
  tone = 'navy',
  icon,
  className,
}: {
  /** The radio group's name. */
  name: string;
  value: string;
  checked: boolean;
  onChoose: () => void;
  title: ReactNode;
  text?: ReactNode;
  /** A short mono line above, such as "Supply side" (big doors). */
  side?: ReactNode;
  /** A route line with its places (big doors). */
  route?: ReactNode;
  /** The words shown once the door is chosen, such as "Selected". */
  picked: ReactNode;
  size?: 'big' | 'small';
  /**
   * The surface the door is drawn for. `navy` (the default) is the board's raised card on a navy band; `light` is
   * the UI/UX.v4.1 card on the light surface, with the L3 chosen state (2 px selected edge, selected fill).
   */
  tone?: 'navy' | 'light';
  /** UI/UX.v4.1 L2: the one owned icon of the choice, an existing icon name drawn in a 44 px soft square. */
  icon?: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      className={[
        'ux-door',
        size === 'big' ? 'is-big' : '',
        tone === 'light' ? 'is-light' : '',
        icon ? 'has-icon' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        className="sr-only"
        type="radio"
        name={name}
        id={id}
        value={value}
        checked={checked}
        onChange={onChoose}
      />
      <label htmlFor={id}>
        {/* The radio circle drawn on the card, so the choice reads as a radio at a glance (the native radio is hidden). */}
        <span className="ux-door-dot" aria-hidden="true" />
        {icon ? (
          <span className="ux-door-tile" aria-hidden="true">
            <CorridraIcon name={icon} />
          </span>
        ) : null}
        {side ? <span className="ux-door-side">{side}</span> : null}
        {route ? <span className="ux-door-route">{route}</span> : null}
        <strong>{title}</strong>
        {text ? <span className="ux-door-text">{text}</span> : null}
        {checked ? (
          <span className="ux-door-picked">
            <CorridraIcon name="check" size={16} />
            {picked}
          </span>
        ) : null}
      </label>
    </div>
  );
}
