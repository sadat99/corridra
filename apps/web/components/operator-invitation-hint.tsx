'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * `headingLevel` and `className` let a page that nests the hint under its own heading (the Account Security tab)
 * lower the heading and style the section. With neither, the markup is exactly what it always was.
 */
export function OperatorInvitationHint({
  headingLevel = 2,
  className = 'operator-section',
}: {
  headingLevel?: 2 | 3;
  className?: string;
}) {
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
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section className={className} aria-label="Pending team invitation">
      <Heading>Finish your team setup</Heading>
      <p>
        You have a pending team invitation. Set your team password, then sign in and add your
        authenticator app.
      </p>
      <Link prefetch={false} className="primary-link" href="/operator/setup">
        Finish team setup
      </Link>
    </section>
  );
}
