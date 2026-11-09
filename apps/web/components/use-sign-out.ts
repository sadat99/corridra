'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { clearPrivateRequestStorage } from '../lib/private-request-storage';
import { announceSessionChange } from './session-events';
import { signInPath } from '../lib/account-return';

/**
 * One sign-out for the header and the account page. The sign-in SDK loads only when someone
 * actually signs out, so public pages do not carry it. With `returnTo` the sign-in page is told where the person was
 * (it still decides which destinations it will honour); without it the destination is plain /signin as always.
 */
export function useSignOut(returnTo?: string | (() => string)) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function signOut() {
    setBusy(true);
    setMessage('');
    try {
      const { accountClient } = await import('../lib/neon-auth-client');
      const result = await accountClient.signOut();
      if (result.error) throw new Error();
      try {
        clearPrivateRequestStorage(sessionStorage);
      } catch {
        /* Logout still clears the provider session. */
      }
      announceSessionChange();
      router.replace(signInPath(typeof returnTo === 'function' ? returnTo() : returnTo));
      router.refresh();
    } catch {
      setMessage('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, signOut };
}
