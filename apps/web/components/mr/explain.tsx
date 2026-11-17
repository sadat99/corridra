'use client';

import './explain.css';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Explain: a symbol with its visible word and one plain sentence (visual grammar, 17 November 2026).
 *
 * The word is always visible and is the button's accessible name. The sentence is extra: it opens on
 * pointer hover (mouse or pen, after 150 ms), on keyboard focus and on a touch tap, never through a
 * `title`. It stays open while the pointer is on the symbol or on the sentence and closes 100 ms after
 * it leaves both (WCAG 1.4.13); Escape, a tap outside and opening another one close it. The popup is
 * in the server HTML, so without JavaScript CSS shows it on hover and focus; once hydrated, `data-js`
 * hands control to state. The words arrive translated: this component never looks anything up.
 */

type OpenedBy = 'hover' | 'focus' | 'tap';

/** Only one explanation is open at a time: opening one tells the others to close. */
const openEvent = 'mr-explain-open';
const openDelay = 150;
const closeDelay = 100;
/** Space kept between the popup and the screen edge when it has to be moved sideways. */
const gutter = 8;

export function Explain({
  name,
  text,
  children,
  placement = 'bottom',
  className,
}: {
  /** The visible word, also the button's accessible name. Already translated. */
  name: string;
  /** One plain sentence. Already translated. */
  text: string;
  /** The symbol. Hidden from screen readers: the word carries the meaning. */
  children: ReactNode;
  /** Where the popup prefers to open; it flips when there is no room. */
  placement?: 'bottom' | 'top';
  className?: string;
}) {
  const id = useId();
  const popId = `${id}-pop`;
  const root = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef<string | null>(null);
  const [openedBy, setOpenedBy] = useState<OpenedBy | null>(null);
  const open = openedBy !== null;

  const wait = (ms: number, then: () => void) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(then, ms);
  };
  const show = (by: OpenedBy) => {
    clearTimeout(timer.current);
    setOpenedBy(by);
    window.dispatchEvent(new CustomEvent(openEvent, { detail: id }));
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpenedBy(null);
  };

  // Hydrated: from here state, not CSS :hover and :focus-within, decides what is shown.
  useEffect(() => {
    const wrapper = root.current;
    if (wrapper) wrapper.dataset.js = '';
    const onOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) setOpenedBy(null);
    };
    window.addEventListener(openEvent, onOther);
    return () => {
      window.removeEventListener(openEvent, onOther);
      clearTimeout(timer.current);
    };
  }, [id]);

  // While open: Escape (capture phase, so a dialog behind it keeps its own Escape) and a tap outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpenedBy(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpenedBy(null);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // Measured once on open: flip above or below for room, and keep it inside the screen sideways. These
  // are measurements of the page, so they are written onto the element rather than kept in state.
  useLayoutEffect(() => {
    const wrapper = root.current;
    const box = pop.current;
    if (!wrapper || !box) return;
    wrapper.dataset.side = placement;
    wrapper.style.removeProperty('--mr-explain-shift');
    if (!open) return;
    let rect = box.getBoundingClientRect();
    const trigger = wrapper.getBoundingClientRect();
    const below = window.innerHeight - trigger.bottom;
    const above = trigger.top;
    if (placement === 'bottom' && rect.bottom > window.innerHeight && above > below)
      wrapper.dataset.side = 'top';
    if (placement === 'top' && rect.top < 0 && below > above) wrapper.dataset.side = 'bottom';
    rect = box.getBoundingClientRect();
    const view = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.right > view - gutter) shift = view - gutter - rect.right;
    if (rect.left + shift < gutter) shift = gutter - rect.left;
    if (shift !== 0) wrapper.style.setProperty('--mr-explain-shift', `${Math.round(shift)}px`);
  }, [open, placement]);

  return (
    <span
      ref={root}
      className={className ? `mr-explain ${className}` : 'mr-explain'}
      data-open={open ? '' : undefined}
      data-side={placement}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        if (open) clearTimeout(timer.current);
        else wait(openDelay, () => show('hover'));
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'touch') return;
        if (openedBy === 'hover') wait(closeDelay, () => setOpenedBy(null));
        else if (!open) clearTimeout(timer.current);
      }}
    >
      <button
        type="button"
        className="mr-explain-trigger"
        aria-describedby={popId}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
        }}
        onFocus={() => {
          // A touch tap also focuses the button; the tap itself toggles, so focus waits for it.
          if (pointer.current !== 'touch') show('focus');
        }}
        onBlur={(event) => {
          if (!root.current?.contains(event.relatedTarget as Node | null)) hide();
        }}
        onClick={(event) => {
          const by = pointer.current;
          pointer.current = null;
          // Touch taps and Enter or Space (detail 0) toggle; a mouse click keeps it open.
          if (by === 'touch' || event.detail === 0) {
            if (open) hide();
            else show('tap');
          } else if (!open) show('focus');
          else setOpenedBy('tap');
        }}
      >
        <span className="mr-explain-symbol" aria-hidden="true">
          {children}
        </span>
        <span className="mr-explain-word">{name}</span>
      </button>
      <span ref={pop} role="tooltip" id={popId} className="mr-explain-pop">
        <span className="mr-explain-name">{name}</span>
        <span className="mr-explain-text">{text}</span>
      </span>
    </span>
  );
}
