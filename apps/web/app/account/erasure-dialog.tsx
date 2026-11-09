'use client';
import type { FormEvent } from 'react';
import { Dialog } from '../../components/ux/dialog';
import { accountWords } from './account-lifecycle-words';
import { LifecycleErrorLine } from './lifecycle-error-line';

/**
 * The one place a person reads what asking for erasure means (the reply time and which records are kept) and confirms it.
 * Nothing is sent until Send Erasure Request; Cancel closes it.
 */
export function ErasureDialog({
  open,
  busy,
  message,
  onSubmit,
  onClose,
  returnFocusTo,
}: {
  open: boolean;
  busy: boolean;
  message: string | null;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={accountWords.erasureTitle}
      locked={busy}
      returnFocusTo={returnFocusTo}
    >
      <form onSubmit={onSubmit}>
        <p>{accountWords.erasureBody}</p>
        <LifecycleErrorLine message={message} />
        <div className="ux-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            data-autofocus=""
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button type="submit" className="primary-link" disabled={busy}>
            {busy ? 'Please Wait…' : 'Send Erasure Request'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
