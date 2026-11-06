'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import './site-header.css';
import { CornerDock } from './corner-dock';
import { CorridraIcon } from './corridra-icon';
import { LanguageSwitcher } from './language-switcher';
import { useLanguage } from './language-provider';
import { useSignedIn } from './use-signed-in';
import { useSignOut } from './use-sign-out';
import { defaultLocale, localeMeta } from '../lib/i18n/locales';
import { translate, type MessageKey } from '../lib/i18n/messages';
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
 * The six jobs under What we do (navigation v1, board PublicHeader B), each to the page that already explains it.
 * The same six pages stay in the footer.
 */
const jobs = [
  { href: '/sell', icon: 'sell', title: 'header.job.sell', line: 'home.start.sell.text' },
  { href: '/source', icon: 'search', title: 'header.job.source', line: 'home.start.buy.text' },
  {
    href: '/machinery',
    icon: 'buy',
    title: 'header.job.machinery',
    line: 'header.job.machinery.line',
  },
  {
    href: '/trade-missions',
    icon: 'trip',
    title: 'header.job.tradeMission',
    line: 'header.job.tradeMission.line',
  },
  {
    href: '/business-trips',
    icon: 'calendar',
    title: 'header.job.businessTrip',
    line: 'header.job.businessTrip.line',
  },
  {
    href: '/enter-market',
    icon: 'globe',
    title: 'header.job.enterMarket',
    line: 'header.job.enterMarket.line',
  },
] as const satisfies readonly { href: string; icon: string; title: MessageKey; line: MessageKey }[];

/** The three section links after What we do. */
const sections = [
  { href: '/how-it-works', key: 'header.howItWorks' },
  { href: '/corridors', key: 'header.markets' },
  { href: '/trust', key: 'header.trust' },
] as const satisfies readonly { href: string; key: MessageKey }[];

const focusable =
  'a[href], button:not([disabled]), summary, input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** The controls a person can reach by Tab inside the open menu, in order. */
function reachable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(focusable)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

/**
 * The language chips of the phone menu (board PublicMobile, Menu open). The same offered languages and the same
 * stored choice as the language chip on a wide screen, so a language that is not offered never appears. With
 * English alone there are no chips.
 */
function LanguageChips() {
  const { locale, offered, choose, t } = useLanguage();
  if (offered.length < 2) return null;
  return (
    <div className="public-nav-languages" role="group" aria-labelledby="public-languages">
      <p id="public-languages" className="public-nav-label">
        {t('language.label')}
      </p>
      <div className="public-nav-chips">
        {offered.map(({ code, draft }) => (
          <button
            type="button"
            key={code}
            lang={localeMeta[code].html}
            dir={localeMeta[code].dir}
            aria-pressed={code === locale}
            onClick={() => choose(code)}
          >
            {localeMeta[code].name}
            {draft && <small> ({t('language.draft')})</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The public header (navigation v1, boards PublicHeader and PublicMobile). A wide screen shows one bar: What we do
 * (a panel with the six jobs), How it works, Markets and Trust, then the language chip, Sign in and Start a Request.
 * A narrower screen shows Menu, which opens the same links as a sheet over the page: focus stays inside it, Escape
 * closes it and returns focus to Menu. On signed-in pages with `CORRIDRA_UX_SHELLS_V2` on, the root layout shows the
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
  const { t, locale } = useLanguage();
  const pathname = usePathname();
  const who = useSignedIn(accounts);
  const { busy, message, signOut } = useSignOut();
  const [open, setOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const whatWeDo = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  // Words with no reviewed translation are English in every catalog; say so where another language is shown.
  const english = (key: MessageKey) =>
    locale !== defaultLocale && t(key) === translate(defaultLocale, key) ? 'en' : undefined;
  const current = (href: string) => (pathname === href ? 'page' : undefined);
  const account = who === 'staff' ? '/operator' : '/account';

  function close() {
    setOpen(false);
    setJobsOpen(false);
  }

  // While the menu is open the rest of the page is inert, and the menu closes when the screen becomes wide enough
  // for the bar (the Menu button is then not shown).
  useEffect(() => {
    const element = header.current;
    if (!open || !element?.parentElement) return;
    const others = Array.from(element.parentElement.children).filter(
      (child) => child !== element && !child.hasAttribute('inert'),
    );
    for (const other of others) other.setAttribute('inert', '');
    const resized = () => {
      if (toggle.current && toggle.current.getClientRects().length === 0) {
        setOpen(false);
        setJobsOpen(false);
      }
    };
    window.addEventListener('resize', resized);
    return () => {
      for (const other of others) other.removeAttribute('inert');
      window.removeEventListener('resize', resized);
    };
  }, [open]);

  // On a wide screen the What we do panel closes on a press anywhere outside the header.
  useEffect(() => {
    if (!jobsOpen || open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target))
        setJobsOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [jobsOpen, open]);

  return (
    <header
      className="site-header public-header"
      data-open={open ? 'true' : undefined}
      ref={header}
      onBlur={(event) => {
        // The open menu keeps focus inside itself; the wide-screen panel closes when focus leaves the header.
        if (!open && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget))
          setJobsOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (open) {
            close();
            toggle.current?.focus();
          } else if (jobsOpen) {
            setJobsOpen(false);
            whatWeDo.current?.focus();
          }
          return;
        }
        if (event.key !== 'Tab' || !open) return;
        const stops = reachable(event.currentTarget);
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <Link prefetch={false} className="brand" href="/" aria-label={t('header.home')}>
        <BrandLockup />
      </Link>
      <CornerDock variant="header" />
      <button
        ref={toggle}
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls="public-navigation"
        onClick={() => {
          // The sheet opens with What we do expanded (board PublicMobile, Menu open).
          setJobsOpen(!open);
          setOpen(!open);
        }}
      >
        {!open && <CorridraIcon name="list" size={20} />}
        {open ? t('header.menuClose') : t('header.menu')}
      </button>
      <nav
        id="public-navigation"
        className={open ? 'public-nav is-open' : 'public-nav'}
        aria-label={t('header.nav')}
      >
        <button
          ref={whatWeDo}
          type="button"
          className="public-nav-what"
          aria-expanded={jobsOpen}
          aria-controls="public-jobs"
          data-current={jobs.some(({ href }) => href === pathname) ? 'true' : undefined}
          onClick={() => setJobsOpen(!jobsOpen)}
        >
          <span lang={english('header.whatWeDo')}>{t('header.whatWeDo')}</span>
          <CorridraIcon name="chevron" size={16} className="public-nav-chevron" />
        </button>
        <div id="public-jobs" className="public-jobs" hidden={!jobsOpen}>
          <p className="public-nav-label" lang={english('header.jobs')}>
            {t('header.jobs')}
          </p>
          <ul>
            {jobs.map(({ href, icon, title, line }) => (
              <li key={href}>
                <Link prefetch={false} href={href} aria-current={current(href)} onClick={close}>
                  <span className="public-job-icon">
                    <CorridraIcon name={icon} size={20} />
                  </span>
                  <span className="public-job-words">
                    <span className="public-job-title" lang={english(title)}>
                      {t(title)}
                    </span>
                    <span className="public-job-line" lang={english(line)}>
                      {t(line)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="public-jobs-foot">
            <Link prefetch={false} className="public-jobs-else" href="/plan" onClick={close}>
              {t('home.else')}
              <CorridraIcon name="arrow" size={18} />
            </Link>
            <span className="public-jobs-note">
              <CorridraIcon name="check" size={16} />
              {t('home.calm.account')}
            </span>
          </div>
        </div>
        {sections.map(({ href, key }) => (
          <Link
            prefetch={false}
            key={href}
            className="public-nav-link"
            href={href}
            aria-current={current(href)}
            onClick={close}
          >
            <span lang={english(key)}>{t(key)}</span>
            <CorridraIcon name="chevron" size={16} className="public-nav-chevron" />
          </Link>
        ))}
        <LanguageChips />
        <div className="public-nav-actions">
          <LanguageSwitcher />
          {who ? (
            <>
              <Link
                prefetch={false}
                className="public-nav-account"
                href={account}
                aria-current={current(account)}
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
            <Link
              prefetch={false}
              className="public-nav-account"
              href="/signin"
              aria-current={current('/signin')}
              onClick={close}
            >
              {t('header.signIn')}
            </Link>
          )}
          <Link
            prefetch={false}
            className="primary-link nav-cta"
            href="/plan"
            aria-current={current('/plan')}
            onClick={close}
          >
            {t('header.start')}
            {!mode && (
              <>
                {' '}
                <span className="sr-only">{t('header.sample')}</span>
              </>
            )}
          </Link>
        </div>
      </nav>
      {message && (
        <p role="alert" className="nav-message">
          {message}
        </p>
      )}
    </header>
  );
}
