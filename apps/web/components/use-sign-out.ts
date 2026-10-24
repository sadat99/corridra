'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { clearPrivateRequestStorage } from '../lib/private-request-storage';
import { announceSessionChange } from './session-events';

/**
 * One sign-out for the header and the account page. The sign-in SDK loads only when someone
 * actually signs out, so public pages do not carry it.
 */
export function useSignOut(provider: 'customer' | 'staff' = 'customer') {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function signOut() {
    setBusy(true);
    setMessage('');
    try {
      const result =
        provider === 'staff'
          ? await (await import('@corridra/auth/client')).identityClient.signOut()
          : await (await import('../lib/neon-auth-client')).accountClient.signOut();
      if (result.error) throw new Error();
      try {
        clearPrivateRequestStorage(sessionStorage);
      } catch {
        /* Logout still clears the provider session. */
      }
      announceSessionChange();
      router.replace(provider === 'staff' ? '/operator/signin' : '/signin');
      router.refresh();
    } catch {
      setMessage('Sign-out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, signOut };
}
