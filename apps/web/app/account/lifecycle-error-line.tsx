'use client';
import { useEffect, useRef } from 'react';
import { useSignOut } from '../../components/use-sign-out';
import { lifecycleWords } from './workspace-lifecycle-client';

/**
 * An error line that takes focus when it appears, so it is read at once. When the refusal asks for a recent sign-in it
 * also offers the way there: signing out leads to the sign-in page.
 */
export function LifecycleErrorLine({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { busy, signOut } = useSignOut();
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
    </>
  );
}
