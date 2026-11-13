'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The install controls on `/install`. Nothing here interrupts anyone: there is no banner, no first-visit
 * dialog and no repeated asking. The page's written steps always stand on their own, and the button appears
 * only where the browser itself has offered to install (Chrome and Edge fire `beforeinstallprompt`; Safari
 * on iPhone and iPad never does, so the written steps are the whole answer there).
 */

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** True only while this window is the installed app. Browsers differ, so a false reading means "not known". */
function runningInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = (window.navigator as { standalone?: boolean }).standalone;
  return window.matchMedia('(display-mode: standalone)').matches || standalone === true;
}

/** Asks again when the window changes between a browser tab and the installed app. */
function watchDisplayMode(onChange: () => void) {
  const query = window.matchMedia('(display-mode: standalone)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function InstallApp() {
  const [offer, setOffer] = useState<InstallPrompt | null>(null);
  // The server renders the browser case, which is what a page that is not the installed app must show.
  const installed = useSyncExternalStore(watchDisplayMode, runningInstalled, () => false);
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | null>(null);

  useEffect(() => {
    function offered(event: Event) {
      // The browser asked first; keeping the event is what lets the page offer the real install later.
      event.preventDefault();
      setOffer(event as InstallPrompt);
    }
    function done() {
      setOffer(null);
      setOutcome('accepted');
    }
    window.addEventListener('beforeinstallprompt', offered);
    window.addEventListener('appinstalled', done);
    return () => {
      window.removeEventListener('beforeinstallprompt', offered);
      window.removeEventListener('appinstalled', done);
    };
  }, []);

  if (installed)
    return (
      <p className="guide-lead" role="status">
        This window is already running as the installed Corridra app.
      </p>
    );

  return (
    <div className="guide-page-actions">
      {offer ? (
        <button
          type="button"
          className="primary-link"
          onClick={async () => {
            const asked = offer;
            setOffer(null);
            await asked.prompt();
            const choice = await asked.userChoice;
            setOutcome(choice.outcome);
          }}
        >
          Install Corridra
        </button>
      ) : null}
      {outcome === 'accepted' ? (
        <p role="status">Corridra is installing. Look for it with your other apps.</p>
      ) : null}
      {outcome === 'dismissed' ? (
        <p role="status">Not installed. The steps below still work whenever you want to.</p>
      ) : null}
    </div>
  );
}
