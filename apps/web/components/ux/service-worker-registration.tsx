'use client';

import { useEffect } from 'react';

/**
 * Registers the offline fallback worker (`/sw.js`), and only that.
 *
 * `enabled` is read on the server from the owner's setting and is false in every development and test build,
 * so `next dev` registers nothing. Registration happens after the page has loaded, so it never competes with
 * the page the person is waiting for, and a browser without service workers simply does nothing: there is no
 * message, no control and no difference to the page.
 */
export function ServiceWorkerRegistration({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    const register = () => {
      if (cancelled) return;
      // A failure here is never shown: the website works the same without the worker.
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', register);
    };
  }, [enabled]);
  return null;
}
