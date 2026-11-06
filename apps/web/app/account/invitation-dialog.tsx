'use client';
// The Reports page's one way in for a private invitation (customer experience spec): a single "Open an
// Invitation" action opens one dialog that holds the two existing forms, open it for this visit and save it to
// the account. The forms keep their own logic, state, requests and retries; they only draw into the dialog
// when this provider is above them, and draw where they always did when it is not (so each still works on its
// own). Nothing here reads, keeps or sends an invitation.
import { createContext, useCallback, useContext, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '../../components/ux/dialog';
import { revealInSubTabs } from '../../components/ux/sub-tabs';
import './invitation-dialog.css';

type Context = {
  /** The dialog is showing, so a form's own notice is drawn inside it, where the person is looking. */
  open: boolean;
  show: () => void;
  /** Closes the dialog and brings a place on the page into view, opening the tab that holds it. */
  finish: (place?: HTMLElement | null) => void;
  openSlot: HTMLElement | null;
  saveSlot: HTMLElement | null;
};
const InvitationContext = createContext<Context | null>(null);
export const useInvitationDialog = () => useContext(InvitationContext);

export function InvitationProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [openSlot, setOpenSlot] = useState<HTMLElement | null>(null);
  const [saveSlot, setSaveSlot] = useState<HTMLElement | null>(null);
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const show = useCallback(() => setOpen(true), []);
  const finish = useCallback((place?: HTMLElement | null) => {
    setOpen(false);
    if (!place) return;
    // The dialog has closed and the page is whole again: open the tab that holds the result, then move there.
    requestAnimationFrame(() => {
      revealInSubTabs(place);
      place.focus({ preventScroll: false });
    });
  }, []);
  return (
    <InvitationContext.Provider value={{ open, show, finish, openSlot, saveSlot }}>
      {children}
      <Dialog open={open} onClose={() => setOpen(false)} title="Open an Invitation" keepMounted>
        <p>
          An invitation is a private link from the team that shared a report or mission with you.
          Open it for this visit, or save it to this account.
        </p>
        <section aria-labelledby={base + '-open'}>
          <h3 id={base + '-open'}>Open It for This Visit</h3>
          <div ref={setOpenSlot} />
        </section>
        <section aria-labelledby={base + '-save'}>
          <h3 id={base + '-save'}>Save It to This Account</h3>
          <div ref={setSaveSlot} className="ux-invite-slot" />
          <p className="ux-invite-empty">Saving invitations is not available right now.</p>
        </section>
      </Dialog>
    </InvitationContext.Provider>
  );
}

/** The page's one action for a private invitation. Draws nothing where there is no provider. */
export function OpenInvitationButton() {
  const invitation = useInvitationDialog();
  if (!invitation) return null;
  return (
    <p>
      <button type="button" className="button button-secondary" onClick={invitation.show}>
        Open an Invitation
      </button>
    </p>
  );
}

/** Draws its children in the dialog when there is one, and where they stand when there is not. */
export function InvitationSlot({ kind, children }: { kind: 'open' | 'save'; children: ReactNode }) {
  const invitation = useInvitationDialog();
  if (!invitation) return <>{children}</>;
  const target = kind === 'open' ? invitation.openSlot : invitation.saveSlot;
  return target ? createPortal(children, target) : null;
}
