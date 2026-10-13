'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { identityClient } from '@corridra/auth/client';
export function ContributorSignout({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <>
      <button
        className="text-link"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await identityClient.signOut();
            if (result.error) throw new Error('Sign-out could not be completed. Try again.');
            router.replace('/contributor');
            router.refresh();
          } catch (e) {
            setMessage(e instanceof Error ? e.message : 'Sign-out failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        Sign out of assigned work
      </button>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
