'use client';

import Link from 'next/link';

import { useRef, useState } from 'react';

export function SiteHeader() {
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
        <Link prefetch={false} href="/signin" onClick={close}>
          Sign in
        </Link>
        <Link prefetch={false} className="primary-link nav-cta" href="/plan" onClick={close}>
          Start a request <span className="sr-only">(sample request)</span>
        </Link>
      </nav>
    </header>
  );
}
