'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { sessionChanged } from './session-events';

/** Who is signed in in this browser: a customer account, a Corridra team member, or no one. */
type SignedIn = 'customer' | 'staff' | null;

// The last answer the public header received, shared so the footer shows the same state without asking again.
let latest: SignedIn = null;
const listeners = new Set<() => void>();

function publish(next: SignedIn) {
  if (next === latest) return;
  latest = next;
  for (const listener of listeners) listener();
}

// True once the header's own check has answered at least once (signed in or not). It adds no request: it only records
// that the answer above is now known, so the footer can tell "not signed in" from "not asked yet".
let settled = false;
function settle() {
  if (settled) return;
  settled = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => latest;
// The customer preview for staff makes no network request at all and shows no one signed in.
export const isQuiet = (path: string | null) => Boolean(path?.startsWith('/operator/view-as'));
// The server never knows who is signed in, so the page is built signed out and updated after load.
const signedOutOnServer = () => null;

/** Asks one identity service whether this browser is signed in. Never throws; unknown means out. */
async function readSignedIn(path: string, signal: AbortSignal) {
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    });
    if (!response.ok) return false;
    const data: unknown = await response.json();
    return typeof data === 'object' && data !== null && 'user' in data && Boolean(data.user);
  } catch {
    return false;
  }
}

/**
 * Who is signed in here, asked by the public header. The customer service is only asked where customer
 * accounts exist. Both are asked again when a sign-in or sign-out happens, when the tab regains focus or
 * when it returns from the back button.
 */
export function useSignedIn(accounts: boolean): SignedIn {
  useEffect(() => {
    if (isQuiet(window.location.pathname)) return;
    let controller = new AbortController();
    function check() {
      controller.abort();
      controller = new AbortController();
      const asked = controller;
      void (async () => {
        const customer = accounts && (await readSignedIn('/api/auth/get-session', asked.signal));
        const next = customer
          ? 'customer'
          : (await readSignedIn('/api/operator-auth/get-session', asked.signal))
            ? 'staff'
            : null;
        if (!asked.signal.aborted) {
          publish(next);
          settle();
        }
      })();
    }
    function refocus() {
      if (document.visibilityState === 'visible') check();
    }
    // A first load also fires `pageshow`, usually just after this effect: asking again there doubled the requests of
    // every public page. Only a page restored from the back button's cache needs a fresh answer.
    function restored(event: PageTransitionEvent) {
      if (event.persisted) check();
    }
    check();
    window.addEventListener(sessionChanged, check);
    window.addEventListener('focus', refocus);
    window.addEventListener('pageshow', restored);
    return () => {
      controller.abort();
      window.removeEventListener(sessionChanged, check);
      window.removeEventListener('focus', refocus);
      window.removeEventListener('pageshow', restored);
    };
  }, [accounts]);
  return useSignedInSeen();
}

/** The header's latest answer, for the footer: it makes no request of its own. */
export function useSignedInSeen(): SignedIn {
  const who = useSyncExternalStore(subscribe, current, signedOutOnServer);
  return isQuiet(usePathname()) ? null : who;
}

const settledNow = () => settled;
const notSettledOnServer = () => false;

/** Whether the header's check has answered yet, for the footer: it makes no request of its own. */
export function useSignedInSettled(): boolean {
  return useSyncExternalStore(subscribe, settledNow, notSettledOnServer);
}
