'use client';

import Image from 'next/image';
import Link from 'next/link';
import { footerGroups } from './site-footer-view';
import { LanguageSwitcher } from './language-switcher';
import { useT } from './language-provider';

// Home page v4.4 footer: the Corridra logo, unchanged and large, over the same link groups as the site footer (each
// destination once), then the privacy line, the copyright and the language. On this page it stands in for the shared
// footer, which is hidden by home-v44.css while this page is shown; every other page keeps the shared one.
export function HomeV44Footer() {
  const t = useT();
  return (
    <footer className="hv7-footer" aria-label={t('footer.nav')}>
      <Link prefetch={false} href="/" className="hv7-footer-logo">
        <Image
          src="/brand/corridra-lockup-horizontal-cobalt.svg"
          alt="Corridra"
          width={1200}
          height={160}
          unoptimized
        />
      </Link>
      <p className="hv7-footer-promise">{t('footer.tagline')}</p>
      <nav className="hv7-footer-groups" aria-label={t('footer.nav')}>
        {footerGroups.map((group) => (
          <div key={group.title} className="hv7-footer-group">
            <h2>{t(group.title)}</h2>
            <ul>
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link prefetch={false} href={link.href}>
                    {t(link.key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="hv7-footer-bottom">
        <span>© 2026 Corridra</span>
        <span>{t('footer.private')}</span>
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
