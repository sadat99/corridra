'use client';
// The reading comfort controls in the help menus (customer, team and the phone avatar menu): Text Size, one row
// with three steps, and the Stronger Colours and Less Movement switches. All are kept in this browser only
// (lib/ux/comfort.ts); a browser that will not save them still gets the choice for the current page, and says so.
// A switch whose effect the device already asks for reads On and does nothing. Owner: W7, W10.
import { useId, useRef, type KeyboardEvent } from 'react';
import { CorridraIcon } from '../corridra-icon';
import {
  deviceAsksNote,
  systemContrastQuery,
  systemReducedMotionQuery,
  textSizes,
  unsavedChoiceNote,
  type TextSize,
} from '../../lib/ux/comfort';
import {
  useContrast,
  useLessMovement,
  useSaveNoteFilled,
  useSystemSetting,
  useTextSize,
} from './use-comfort';

export const textSizeNames: Record<TextSize, string> = {
  normal: 'Normal',
  large: 'Large',
  largest: 'Largest',
};

/**
 * The one live region for the comfort controls on a page. It is always in the page and empty until this browser
 * refuses to keep a choice, then it is filled, so assistive technology announces the note. Never shown on load.
 */
export function UnsavedChoiceNote({ className, inMenu }: { className: string; inMenu?: boolean }) {
  const filled = useSaveNoteFilled();
  // A menu may hold only rows and groups (a status role or a bare ARIA attribute inside one fails the ARIA rules), so
  // there the live region is a group; elsewhere it is a status.
  const live = inMenu
    ? { role: 'group', 'aria-live': 'polite' as const, 'aria-atomic': true }
    : { role: 'status' };
  return (
    <p className={className} {...live}>
      {filled ? unsavedChoiceNote : null}
    </p>
  );
}

/**
 * Text Size: the label and the step in force in words, then Normal, Large and Largest as radio buttons. The menu
 * variant keeps the menu's roving focus; the page variant (Account, Preferences) is a radio group of its own with
 * one tab stop and the arrow keys moving the choice.
 */
export function TextSizeRow({
  label,
  variant = 'menu',
}: {
  label: string;
  variant?: 'menu' | 'page';
}) {
  const [size, setSize] = useTextSize();
  const steps = useRef<HTMLSpanElement>(null);
  const page = variant === 'page';
  const move = (event: KeyboardEvent, index: number) => {
    const last = textSizes.length - 1;
    const target =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? last
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (index + 1) % textSizes.length
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
              ? (index + last) % textSizes.length
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = textSizes[target]!;
    setSize(next);
    steps.current?.querySelector<HTMLElement>(`[data-step="${next}"]`)?.focus();
  };
  return (
    <div
      role={page ? 'radiogroup' : 'group'}
      aria-label={label}
      className={page ? 'ux-textsize ux-comfort-page-row' : 'ux-textsize'}
    >
      <span className="ux-textsize-text">
        <span>{label}</span>
        <span className="ux-textsize-current">{textSizeNames[size]}</span>
      </span>
      <span className="ux-textsize-steps" ref={steps}>
        {textSizes.map((step, index) => (
          <button
            key={step}
            type="button"
            role={page ? 'radio' : 'menuitemradio'}
            aria-checked={size === step}
            // The name starts with the visible character, so the visible text is in the name (WCAG 2.5.3).
            aria-label={`A, ${textSizeNames[step]} Text`}
            tabIndex={page ? (size === step ? 0 : -1) : -1}
            className="ux-textsize-step"
            data-step={step}
            onClick={() => setSize(step)}
            onKeyDown={page ? (event) => move(event, index) : undefined}
          >
            <span aria-hidden="true">A</span>
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * A switch row that says On or Off in words. It stays open when used. When the device already asks for the effect it
 * reads On with a line saying so, is announced as unavailable (still focusable, still 44 px) and a tap does nothing.
 * The name is the label alone and the device line is the description, so neither is read twice.
 */
function ComfortSwitchRow({
  label,
  on,
  bySystem,
  onToggle,
  variant,
}: {
  label: string;
  on: boolean;
  bySystem: boolean;
  onToggle: () => void;
  variant: 'menu' | 'page';
}) {
  const labelId = useId();
  const noteId = useId();
  const page = variant === 'page';
  return (
    <button
      type="button"
      role={page ? 'switch' : 'menuitemcheckbox'}
      aria-checked={on || bySystem}
      aria-disabled={bySystem || undefined}
      aria-labelledby={labelId}
      aria-describedby={bySystem ? noteId : undefined}
      tabIndex={page ? 0 : -1}
      className={
        page ? 'ux-menu-toggle ux-comfort-page-row ux-comfort-switch' : 'ux-menu-row ux-menu-toggle'
      }
      onClick={() => {
        if (!bySystem) onToggle();
      }}
    >
      <span className="ux-menu-toggle-text">
        <span id={labelId}>{label}</span>
        {bySystem ? (
          <span id={noteId} className="ux-textsize-current">
            {deviceAsksNote}
          </span>
        ) : null}
      </span>
      <span className="ux-menu-toggle-state">
        {on || bySystem ? <CorridraIcon name="check" size={16} /> : null}
        <span>{on || bySystem ? 'On' : 'Off'}</span>
      </span>
    </button>
  );
}

/** Stronger Colours: darker text, clearer lines and underlined links (comfort.css). On when chosen or the device asks. */
export function ContrastRow({
  label,
  variant = 'menu',
}: {
  label: string;
  variant?: 'menu' | 'page';
}) {
  const [value, setValue] = useContrast();
  const bySystem = useSystemSetting(systemContrastQuery);
  return (
    <ComfortSwitchRow
      label={label}
      on={value === 'more'}
      bySystem={bySystem}
      onToggle={() => setValue(value === 'more' ? 'normal' : 'more')}
      variant={variant}
    />
  );
}

/**
 * Less Movement. It is last in the group, so it carries the group's one save-failed note (an empty live region until a
 * save fails).
 */
export function LessMovementRow({
  label,
  variant = 'menu',
}: {
  label: string;
  variant?: 'menu' | 'page';
}) {
  const [value, setValue] = useLessMovement();
  const bySystem = useSystemSetting(systemReducedMotionQuery);
  return (
    <>
      <ComfortSwitchRow
        label={label}
        on={value === 'on'}
        bySystem={bySystem}
        onToggle={() => setValue(value === 'on' ? 'off' : 'on')}
        variant={variant}
      />
      {variant === 'page' ? (
        <UnsavedChoiceNote className="ux-comfort-page-note ux-comfort-status" />
      ) : (
        <UnsavedChoiceNote className="ux-menu-note ux-comfort-status" inMenu />
      )}
    </>
  );
}
