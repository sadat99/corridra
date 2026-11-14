'use client';

import { useEffect } from 'react';
import { keepWorkerCurrent } from '../../lib/ux/service-worker-update';

/**
 * Registers the offline fallback worker (`/sw.js`), and only that.
 *
 * `enabled` is read on the server from the owner's setting and is false in every development and test build,
 * so `next dev` registers nothing. Registration happens after the page has loaded, so it never competes with
 * the page the person is waiting for, and a browser without service workers simply does nothing: there is no
 * message, no control and no difference to the page.
 *
 * After registering it asks the browser to check for a newer worker now and whenever the page becomes
 * visible again (at most every ten minutes), so an installed app that stays open or is reopened picks up each
 * deployment's worker. It never reloads the page and shows nothing.
 */
export function ServiceWorkerRegistration({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    let stopWatching = () => {};
    const register = () => {
      if (cancelled) return;
      // A failure here is never shown: the website works the same without the worker.
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          if (!cancelled) stopWatching = keepWorkerCurrent(registration, document);
        })
        .catch(() => {});
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', register);
      stopWatching();
    };
  }, [enabled]);
  return null;
}
