'use client';
// The two reading comfort controls in the help menus (customer, team and the phone avatar menu): Text Size, one
// row with three steps, and the Less Movement switch. Both are kept in this browser only (lib/ux/comfort.ts); a
// browser that will not save them still gets the choice for the current page, and says so. Owner: W7.
import { CorridraIcon } from '../corridra-icon';
import { textSizes, type TextSize } from '../../lib/ux/comfort';
import { useLessMovement, useSaveFailed, useTextSize } from './use-comfort';

export const textSizeNames: Record<TextSize, string> = {
  normal: 'Normal',
  large: 'Large',
  largest: 'Largest',
};

export const unsavedChoiceNote =
  'This browser cannot save your choice. It lasts until you leave this page.';

/**
 * The one live region for the comfort controls on a page. It is always in the page and empty until this browser
 * refuses to keep a choice, then it is filled, so assistive technology announces the note. Never shown on load.
 */
export function UnsavedChoiceNote({ className, inMenu }: { className: string; inMenu?: boolean }) {
  const failed = useSaveFailed();
  // A menu may hold only rows and groups (a status role or a bare ARIA attribute inside one fails the ARIA rules), so
  // there the live region is a group; elsewhere it is a status.
  const live = inMenu
    ? { role: 'group', 'aria-live': 'polite' as const, 'aria-atomic': true }
    : { role: 'status' };
  return (
    <p className={className} {...live}>
      {failed ? unsavedChoiceNote : null}
    </p>
  );
}

/** Text Size: the label and the step in force in words, then Normal, Large and Largest as radio buttons. */
export function TextSizeRow({ label }: { label: string }) {
  const [size, setSize] = useTextSize();
  return (
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
            onClick={() => setSize(step)}
          >
            <span aria-hidden="true">A</span>
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * Less Movement: a switch row that says On or Off in words. It stays open when used. It is last in the group, so it
 * carries the group's one save-failed note (an empty live region until a save fails).
 */
export function LessMovementRow({ label }: { label: string }) {
  const [value, setValue] = useLessMovement();
  const on = value === 'on';
  return (
    <>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        tabIndex={-1}
        className="ux-menu-row ux-menu-toggle"
        onClick={() => setValue(on ? 'off' : 'on')}
      >
        <span>{label}</span>
        <span className="ux-menu-toggle-state">
          {on ? <CorridraIcon name="check" size={16} /> : null}
          <span>{on ? 'On' : 'Off'}</span>
        </span>
      </button>
      <UnsavedChoiceNote className="ux-menu-note ux-comfort-status" inMenu />
    </>
  );
}
