'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { CornerDock } from './corner-dock';
import { LanguageSwitcher } from './language-switcher';
import { useT } from './language-provider';
import { useSignedIn } from './use-signed-in';
import { useSignOut } from './use-sign-out';
import { ORB, WORDMARK } from './brand-paths';

/**
 * The Corridra logo, drawn here only (the design system allows this one inline drawing). Geometry
 * is in brand-paths.ts. Colour is set by CSS (.brand-mark, .brand-word), never by hex in this file.
 * Spec: docs/brand/CORRIDRA_BRAND_IDENTITY.md.
 */
export function BrandMark() {
  return (
    <svg
      className="brand-mark"
      viewBox={ORB.viewBox}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ORB.d} />
      <circle cx={ORB.dot.cx} cy={ORB.dot.cy} r={ORB.dot.r} />
    </svg>
  );
}

export function BrandWordmark() {
  return (
    <svg
      className="brand-word"
      viewBox={WORDMARK.viewBox}
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <path d={WORDMARK.d} />
    </svg>
  );
}

/** Compact lockup: orb then wordmark. The link that wraps it carries the accessible name. */
export function BrandLockup() {
  return (
    <>
      <BrandMark />
      <BrandWordmark />
    </>
  );
}

/**
 * The words of the signed-in shell headers and navigation (D14, CQ-10), kept next to the public
 * header's own words so every header message is listed in one place. The signed-in header reads
 * its words from here; the team sidebar (lib/ux/shells.ts) and the customer tabs (customer-nav.tsx)
 * use the `team` and `nav` keys.
 */
export const shellWords = {
  names: {
    team: 'wse.shell.team',
    customer: 'wse.shell.customer',
    contributor: 'wse.shell.contributor',
  },
  live: 'wse.shell.live',
  preview: 'wse.shell.preview',
  statusLabel: 'wse.shell.statusLabel',
  inbox: 'wse.shell.inbox',
  menu: 'wse.shell.menu',
  website: 'wse.shell.website',
  help: 'wse.shell.help',
  trustNote: 'wse.trust.note',
  team: [
    'wse.team.nav',
    'wse.team.today',
    'wse.team.missions',
    'wse.team.companies',
    'wse.team.meetings',
    'wse.team.quotes',
    'wse.team.reports',
    'wse.team.network',
    'wse.team.evidence',
    'wse.team.settings',
    'wse.team.owner',
  ],
  nav: [
    'wse.nav.customer',
    'wse.nav.home',
    'wse.nav.move',
    'wse.nav.missions',
    'wse.nav.work',
    'wse.nav.companies',
    'wse.nav.library',
    'wse.nav.results',
    'wse.nav.more',
  ],
} as const satisfies Record<string, unknown>;

/**
 * The public header. On signed-in pages with `CORRIDRA_UX_SHELLS_V2` on, the root layout shows the
 * shell's own header instead (components/ux/shell-header.tsx).
 */
export function SiteHeader({
  accounts = false,
  mode,
}: {
  accounts?: boolean;
  /**
   * UX update (`CORRIDRA_UX_FIRSTQ`, read on the server): the start button keeps its plain name. The
   * site-wide Sample or Real badge is no longer shown in the public header (CQ-47); the team shell
   * shows "Live" or "Preview" instead. Absent keeps the "(sample request)" screen-reader text.
   */
  mode?: 'sample' | 'real';
}) {
  const t = useT();
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
        <BrandLockup />
      </Link>
      <CornerDock variant="header" />
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
