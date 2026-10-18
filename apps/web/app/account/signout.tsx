'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { accountClient } from '../../lib/neon-auth-client';
import { clearPrivateRequestStorage } from '../../lib/private-request-storage';
export function AccountSignout() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function signout() {
    setBusy(true);
    setMessage('');
    try {
      const result = await accountClient.signOut();
      if (result.error) throw new Error();
      try {
        clearPrivateRequestStorage(sessionStorage);
      } catch {
        /* Logout still clears the provider session. */
      }
      router.replace('/signin');
      router.refresh();
    } catch {
      setMessage('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="primary-link" disabled={busy} onClick={signout}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
