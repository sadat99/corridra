'use client';

import Link from 'next/link';

import { useEffect, useRef, useState } from 'react';
import { sessionChanged } from './session-events';
import { useSignOut } from './use-sign-out';

/** Asks the account service whether this browser is signed in. Never throws; unknown means out. */
async function readSignedIn(signal: AbortSignal) {
  try {
    const response = await fetch('/api/auth/get-session', {
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
 * Whether this visitor is signed in. Only asked where customer accounts exist, and again when a
 * sign-in or sign-out happens, when the tab regains focus or when it returns from the back button.
 */
function useSignedIn(accounts: boolean) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!accounts) return;
    let controller = new AbortController();
    function check() {
      controller.abort();
      controller = new AbortController();
      const current = controller;
      void readSignedIn(current.signal).then((value) => {
        if (!current.signal.aborted) setSignedIn(value);
      });
    }
    function refocus() {
      if (document.visibilityState === 'visible') check();
    }
    check();
    window.addEventListener(sessionChanged, check);
    window.addEventListener('focus', refocus);
    window.addEventListener('pageshow', check);
    return () => {
      controller.abort();
      window.removeEventListener(sessionChanged, check);
      window.removeEventListener('focus', refocus);
      window.removeEventListener('pageshow', check);
    };
  }, [accounts]);
  return accounts && signedIn;
}

export function SiteHeader({ accounts = false }: { accounts?: boolean }) {
  const signedIn = useSignedIn(accounts);
  const { busy, message, signOut } = useSignOut();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  function close() {
    setOpen(false);
  }
  return (
    <header
      className="site-header public-header"
      ref={header}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close();
          toggle.current?.focus();
        }
      }}
    >
      <Link prefetch={false} className="brand" href="/" aria-label="Corridra home">
        <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M25 5H14a11 11 0 0 0 0 22h11M25 12H15a4 4 0 0 0 0 8h10"
            stroke="currentColor"
            strokeWidth="3"
          />
        </svg>
        <span>Corridra</span>
      </Link>
      <button
        ref={toggle}
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="public-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? 'Close menu' : 'Menu'} <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <nav
        id="public-navigation"
        className={open ? 'public-nav is-open' : 'public-nav'}
        aria-label="Main navigation"
      >
        <Link prefetch={false} href="/how-it-works" onClick={close}>
          How it works
        </Link>
        <Link prefetch={false} href="/corridors" onClick={close}>
          Routes
        </Link>
        {signedIn ? (
          <>
            <Link prefetch={false} href="/account" onClick={close}>
              Your account
            </Link>
            <button
              type="button"
              className="header-link nav-signout"
              disabled={busy}
              onClick={signOut}
            >
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </>
        ) : (
          <Link prefetch={false} href="/signin" onClick={close}>
            Sign in
          </Link>
        )}
        <Link prefetch={false} className="primary-link nav-cta" href="/plan" onClick={close}>
          Start a request <span className="sr-only">(sample request)</span>
        </Link>
      </nav>
      {message && (
        <p role="alert" className="nav-message">
          {message}
        </p>
      )}
    </header>
  );
}
