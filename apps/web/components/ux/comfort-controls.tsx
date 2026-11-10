'use client';
// The two reading comfort controls in the help menus (customer, team and the phone avatar menu): Text Size, one
// row with three steps, and the Less Movement switch. Both are kept in this browser only (lib/ux/comfort.ts); a
// browser that will not save them still gets the choice for the current page, and says so. Owner: W7.
import { useState } from 'react';
import { CorridraIcon } from '../corridra-icon';
import { textSizes, type TextSize } from '../../lib/ux/comfort';
import { useLessMovement, useTextSize } from './use-comfort';

export const textSizeNames: Record<TextSize, string> = {
  normal: 'Normal',
  large: 'Large',
  largest: 'Largest',
};

export const unsavedChoiceNote =
  'This browser cannot save your choice. It lasts until you leave this page.';

/** Shown only after a save failed, never on load. */
export function UnsavedChoiceNote() {
  return (
    <p role="status" className="ux-menu-note">
      {unsavedChoiceNote}
    </p>
  );
}

/** Text Size: the label and the step in force in words, then Normal, Large and Largest as radio buttons. */
export function TextSizeRow({ label }: { label: string }) {
  const [size, setSize] = useTextSize();
  const [unsaved, setUnsaved] = useState(false);
  return (
    <>
      <div role="group" aria-label={label} className="ux-textsize">
        <span className="ux-textsize-text">
          <span>{label}</span>
          <span className="ux-textsize-current">{textSizeNames[size]}</span>
        </span>
        <span className="ux-textsize-steps">
          {textSizes.map((step) => (
            <button
              key={step}
              type="button"
              role="menuitemradio"
              aria-checked={size === step}
              aria-label={`${textSizeNames[step]} Text`}
              tabIndex={-1}
              className="ux-textsize-step"
              data-step={step}
              onClick={() => setUnsaved(!setSize(step))}
            >
              <span aria-hidden="true">A</span>
            </button>
          ))}
        </span>
      </div>
      {unsaved ? <UnsavedChoiceNote /> : null}
    </>
  );
}

/** Less Movement: a switch row that says On or Off in words. It stays open when used. */
export function LessMovementRow({ label }: { label: string }) {
  const [value, setValue] = useLessMovement();
  const [unsaved, setUnsaved] = useState(false);
  const on = value === 'on';
  return (
    <>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        tabIndex={-1}
        className="ux-menu-row ux-menu-toggle"
        onClick={() => setUnsaved(!setValue(on ? 'off' : 'on'))}
      >
        <span>{label}</span>
        <span className="ux-menu-toggle-state">
          {on ? <CorridraIcon name="check" size={16} /> : null}
          <span>{on ? 'On' : 'Off'}</span>
        </span>
      </button>
      {unsaved ? <UnsavedChoiceNote /> : null}
    </>
  );
}
