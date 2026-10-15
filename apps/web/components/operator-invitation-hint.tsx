'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function OperatorInvitationHint() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    async function check() {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      setAvailable(false);
      try {
        const response = await fetch('/api/operator-setup', {
          cache: 'no-store',
          signal: requestController.signal,
        });
        const data = response.ok ? await response.json() : null;
        if (active && !requestController.signal.aborted) setAvailable(data?.available === true);
      } catch {
        /* Sign-in remains available when invitation lookup is unavailable. */
      }
    }
    void check();
    const refresh = () => {
      if (document.visibilityState === 'visible') void check();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  if (!available) return null;
  return (
    <section className="operator-section" aria-label="Pending team invitation">
      <h2>Finish your team setup</h2>
      <p>
        You have a pending team invitation. Set your team password, then sign in and add your
        authenticator app.
      </p>
      <Link className="primary-link" href="/operator/setup">
        Finish team setup
      </Link>
    </section>
  );
}
