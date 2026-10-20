'use client';
import { useSignOut } from '../../components/use-sign-out';
export function AccountSignout() {
  const { busy, message, signOut } = useSignOut();
  return (
    <>
      <button className="primary-link" disabled={busy} onClick={signOut}>
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
      {message && <p role="alert">{message}</p>}
    </>
  );
}
