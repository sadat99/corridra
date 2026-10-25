'use client';

import Link from 'next/link';

import { useEffect, useRef, useState } from 'react';
import { LanguageSwitcher } from './language-switcher';
import { ModeLabel } from './mr/mode-label';
import { mrLabelsFor } from './mr/labels';
import { useLanguage, useT } from './language-provider';
import { sessionChanged } from './session-events';
import { useSignOut } from './use-sign-out';

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
 * Who is signed in here: a customer account, a Corridra team member (a separate sign-in), or no one.
 * The customer service is only asked where customer accounts exist. Both are asked again when a
 * sign-in or sign-out happens, when the tab regains focus or when it returns from the back button.
 */
function useSignedIn(accounts: boolean): 'customer' | 'staff' | null {
  const [who, setWho] = useState<'customer' | 'staff' | null>(null);
  // The customer preview for staff makes no network request at all, so the header stays quiet there.
  useEffect(() => {
    if (window.location.pathname.startsWith('/operator/view-as')) return;
    let controller = new AbortController();
    function check() {
      controller.abort();
      controller = new AbortController();
      const current = controller;
      void (async () => {
        const customer = accounts && (await readSignedIn('/api/auth/get-session', current.signal));
        const next = customer
          ? 'customer'
          : (await readSignedIn('/api/operator-auth/get-session', current.signal))
            ? 'staff'
            : null;
        if (!current.signal.aborted) setWho(next);
      })();
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
  return who;
}

export function SiteHeader({
  accounts = false,
  mode,
}: {
  accounts?: boolean;
  /**
   * UX update (`CORRIDRA_UX_FIRSTQ`, read on the server): one Sample or Real label for the whole site
   * replaces the "(sample request)" screen-reader text on the start button. Absent is the header as it was.
   */
  mode?: 'sample' | 'real';
}) {
  const t = useT();
  const { locale } = useLanguage();
  const who = useSignedIn(accounts);
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
      <Link prefetch={false} className="brand" href="/" aria-label={t('header.home')}>
        <svg className="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M25 5H14a11 11 0 0 0 0 22h11M25 12H15a4 4 0 0 0 0 8h10"
            stroke="currentColor"
            strokeWidth="3"
          />
        </svg>
        <span>Corridra</span>
      </Link>
      {mode && <ModeLabel real={mode === 'real'} labels={mrLabelsFor(locale).mode} />}
      <button
        ref={toggle}
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="public-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? t('header.menuClose') : t('header.menu')}{' '}
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <nav
        id="public-navigation"
        className={open ? 'public-nav is-open' : 'public-nav'}
        aria-label={t('header.nav')}
      >
        <Link prefetch={false} href="/how-it-works" onClick={close}>
          {t('header.howItWorks')}
        </Link>
        <Link prefetch={false} href="/corridors" onClick={close}>
          {t('header.routes')}
        </Link>
        {who ? (
          <>
            <Link
              prefetch={false}
              href={who === 'staff' ? '/operator' : '/account'}
              onClick={close}
            >
              {who === 'staff' ? t('header.workspace') : t('header.account')}
            </Link>
            {who === 'customer' && (
              <button
                type="button"
                className="header-link nav-signout"
                disabled={busy}
                onClick={signOut}
              >
                {busy ? t('header.signingOut') : t('header.signOut')}
              </button>
            )}
          </>
        ) : (
          <Link prefetch={false} href="/signin" onClick={close}>
            {t('header.signIn')}
          </Link>
        )}
        <LanguageSwitcher />
        <Link prefetch={false} className="primary-link nav-cta" href="/plan" onClick={close}>
          {t('header.start')}
          {!mode && (
            <>
              {' '}
              <span className="sr-only">{t('header.sample')}</span>
            </>
          )}
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
