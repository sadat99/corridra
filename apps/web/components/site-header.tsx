'use client';
import { Arrow } from './arrow';

import Link from 'next/link';

import { useRef, useState } from 'react';

export const solutions = [
  { href: '/sell', label: 'Sell in a new market' },
  { href: '/source', label: 'Source products/suppliers' },
  { href: '/machinery', label: 'Procure machinery' },
  { href: '/business-trips', label: 'Plan a business trip' },
  { href: '/enter-market', label: 'Enter a new market' },
  { href: '/trade-missions', label: 'Run a trade mission' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const header = useRef<HTMLElement>(null);
  function close() {
    setOpen(false);
    if (details.current) details.current.open = false;
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
          const expanded = details.current?.open;
          close();
          if (expanded && !open) details.current?.querySelector('summary')?.focus();
          else toggle.current?.focus();
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
        <span>corridra</span>
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
        <details className="solutions-menu" ref={details}>
          <summary>
            Solutions{' '}
            <span aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="m3 4 3 3 3-3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </span>
          </summary>
          <div className="solutions-list">
            {solutions.map(({ href, label }) => (
              <Link prefetch={false} key={href} href={href} onClick={close}>
                {label}
              </Link>
            ))}
          </div>
        </details>
        <Link prefetch={false} href="/how-it-works" onClick={close}>
          How it works
        </Link>
        <Link prefetch={false} href="/corridors" onClick={close}>
          Corridors
        </Link>
        <Link prefetch={false} href="/institutions" onClick={close}>
          For Institutions
        </Link>
        <Link prefetch={false} href="/trust" onClick={close}>
          Trust & Evidence
        </Link>
        <Link prefetch={false} href="/signin" onClick={close}>
          Sign in
        </Link>
        <Link prefetch={false} href="/workspace" onClick={close}>
          Workspaces
        </Link>
        <Link prefetch={false} className="primary-link nav-cta" href="/plan" onClick={close}>
          Plan a mission <span className="sr-only">(test intake)</span>
          <span aria-hidden="true">
            <Arrow />
          </span>
        </Link>
      </nav>
    </header>
  );
}
