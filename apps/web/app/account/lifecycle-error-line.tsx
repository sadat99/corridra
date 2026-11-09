'use client';
import { useEffect, useRef, useState } from 'react';
import { endSession } from '../../lib/end-session';
import { signInPath } from '../../lib/account-return';
import { lifecycleWords } from './workspace-lifecycle-client';

/**
 * An error line that takes focus when it appears, so it is read at once. When the refusal asks for a recent sign-in it
 * also offers the way there: signing out leads to the sign-in page. It leaves by a plain page load, not the router, so the
 * workspace screens do not carry the router just for this one button.
 */
export function LifecycleErrorLine({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false);
  const [signOutMessage, setSignOutMessage] = useState('');
  async function signOut() {
    setBusy(true);
    setSignOutMessage('');
    try {
      await endSession();
      window.location.assign(signInPath(window.location.pathname));
    } catch {
      setSignOutMessage('Sign-out could not be completed. Please try again.');
      setBusy(false);
    }
  }
  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);
  if (!message) return null;
  return (
    <>
      <p ref={ref} tabIndex={-1} role="alert" className="ux-error-summary">
        {message}
      </p>
      {message === lifecycleWords.signInAgain && (
        <button type="button" className="text-link" disabled={busy} onClick={signOut}>
          {busy ? 'Signing Out…' : 'Sign Out and Sign In Again'}
        </button>
      )}
      {signOutMessage && <p role="alert">{signOutMessage}</p>}
    </>
  );
}
