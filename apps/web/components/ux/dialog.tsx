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
  locked = false,
  returnFocusTo,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closeLabel?: string;
  /** Keep the content in the page while the dialog is closed, so state inside it survives a close. */
  keepMounted?: boolean;
  /**
   * A request is in flight: Escape, the Close button and a click on the dimmed area do nothing until it
   * settles, so the answer is never lost with the dialog's state. The caller sets it from the request.
   */
  locked?: boolean;
  /** Where focus goes on close when the control that opened the dialog is no longer in the page. */
  returnFocusTo?: () => HTMLElement | null;
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
      onCancel={(event) => {
        if (locked) event.preventDefault();
      }}
      onClose={() => {
        const dialog = ref.current;
        // Some browsers close a dialog on a second Escape even when the first was cancelled; a dialog that
        // is still locked and still meant to be open is shown again.
        if (locked && open && dialog && !dialog.open) {
          dialog.showModal();
          return;
        }
        onClose();
        const was = opener.current;
        const back =
          was && was !== document.body && was.isConnected ? was : (returnFocusTo?.() ?? null);
        back?.focus();
        opener.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && locked) {
          event.preventDefault();
          return;
        }
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
        if (event.target === ref.current && !locked) ref.current?.close();
      }}
    >
      <div className="ux-dialog-head">
        <h2 id={titleId}>{title}</h2>
        {locked && (
          <span className="ux-dialog-working" role="status">
            Working…
          </span>
        )}
        <button
          type="button"
          className="ux-dialog-close"
          disabled={locked}
          onClick={() => ref.current?.close()}
        >
          {closeLabel}
        </button>
      </div>
      <div className="ux-dialog-body">{open || keepMounted ? children : null}</div>
    </dialog>
  );
}
