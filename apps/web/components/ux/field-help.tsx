'use client';
// One-line field help with a "?" button that opens the longer rule (UX-09, UX-11). The short line is
// always visible and linked to the field; the details stay one tap away instead of a paragraph under
// every field. Keyboard: Enter or Space opens, Escape closes and returns focus to the button.
// Owner: WS-E.
import './ux-kit.css';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function FieldHelp({
  id,
  summary,
  details,
  label = 'More about this field',
}: {
  /** The id the field points to with aria-describedby. */
  id?: string;
  /** One plain line, always shown. */
  summary: ReactNode;
  /** The longer rule, shown on request. */
  details?: ReactNode;
  /** Accessible name of the "?" button. */
  label?: string;
}) {
  const generated = useId();
  const lineId = id ?? `${generated}-help`;
  const panelId = `${generated}-details`;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      className="ux-kit-help"
      ref={wrapper}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <p className="ux-kit-hint" id={lineId}>
        {summary}
        {details ? (
          <button
            ref={button}
            type="button"
            className="ux-kit-help-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={label}
            onClick={() => setOpen((value) => !value)}
          >
            ?
          </button>
        ) : null}
      </p>
      {details ? (
        <div id={panelId} className="ux-kit-help-panel" role="note" hidden={!open}>
          {details}
        </div>
      ) : null}
    </div>
  );
}
