'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import './dialog.css';

/**
 * A modal dialog on the platform's own <dialog>: focus stays inside while it is open, Escape closes it, and
 * focus returns to the control that opened it. Labelled by its title. The caller owns `open`.
 */
export function Dialog({
  open,
  onClose,
  title,
  closeLabel = 'Close',
  keepMounted = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel?: string;
  /** Keep the content in the page while the dialog is closed, so state inside it survives a close. */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-title`;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ux-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        onClose();
        opener.current?.focus();
        opener.current = null;
      }}
      onKeyDown={(event) => {
        // Tab wraps inside the dialog instead of leaving to the browser's own controls.
        if (event.key !== 'Tab') return;
        const dialog = ref.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        // A click on the dimmed area (the dialog element itself, not its content) closes it.
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="ux-dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="ux-dialog-close" onClick={() => ref.current?.close()}>
          {closeLabel}
        </button>
      </div>
      <div className="ux-dialog-body">{open || keepMounted ? children : null}</div>
    </dialog>
  );
}
