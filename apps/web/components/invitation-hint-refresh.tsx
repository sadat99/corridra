'use client';
// The operator sign-in page draws the invitation hint only when the browser holds a customer session (final walk m2).
// A person can sign in to their customer account in another tab and come back: the hint used to look again on focus
// and when the tab became visible. This keeps that path without a request that fails while signed out: on the same two
// events the page asks the server to draw itself again (an ordinary page read, never refused), and the server mounts
// the hint, which then checks the invitation, once a customer session is there. What the person typed is kept.
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function InvitationHintRefresh() {
  const router = useRouter();
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [router]);
  return null;
}
