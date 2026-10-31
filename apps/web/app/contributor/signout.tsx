'use client';
import { useState } from 'react';
import { identityClient } from '@corridra/auth/client';
export function ContributorSignout({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <>
      <button
        className="text-link"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          let leaving = false;
          try {
            const result = await identityClient.signOut();
            if (result.error) throw new Error('Sign-out could not be completed. Try again.');
            // A full page load, so no route the signed-in session cached survives (KI-30).
            leaving = true;
            window.location.replace('/contributor');
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Sign-out failed');
          } finally {
            if (!leaving) setBusy(false);
          }
        }}
      >
        Sign out of assigned work
      </button>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
