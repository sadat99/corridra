'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import './site-footer-pack.css';
import { LanguageSwitcher } from './language-switcher';
import { useLanguage } from './language-provider';
import { PlaceWords } from './place-words';
import { BrandLockup } from './site-header';
import { doorFor, footerGroups } from './site-footer-view';
import { useSignedInSeen } from './use-signed-in';
import { accessDoors as accessDoorList } from '../lib/access-doors';
import { v43 } from '../lib/home-v43-data';
import { faqRow, solutionRows } from '../lib/home-v43-nav';
import { defaultLocale } from '../lib/i18n/locales';
import { translate, type MessageKey } from '../lib/i18n/messages';
import { revealThenFocus } from '../lib/ux/anchor-focus';

// The public footer while CORRIDRA_UX_HOME_V43 is on (owner, 26 Nov 2026, via the Guardian: "update as per attachment
// 100% correctly"): Solutions, Explore, Already working with us, then the legal row. Each of the 16 destinations of the
// Option B footer is here once. The request page (/plan), the staff preview and the signed-in quiet footer keep theirs.
const quiet = [
  '/source',
  '/machinery',
  '/trade-missions',
  '/business-trips',
  '/sell',
  '/enter-market',
  '/institutions',
  '/network',
] as const;
const explore = [
  { href: '/how-it-works', key: 'footer.link.howItWorks' },
  { href: '/corridors', key: 'header.markets' },
  { href: '/trust', key: 'header.trust' },
] as const satisfies readonly { href: string; key: MessageKey }[];
const exploreQuiet = ['/corridors/bangladesh-eu', '/corridors#mission-example', '/about'] as const;
const links = footerGroups.flatMap((group) => group.links);

export function SiteFooterPack({
  realUse,
  accessDoors = false,
}: {
  realUse: boolean;
  /** CORRIDRA_UX_ACCESS_DOORS: the three access doors replace the three sign-in rows. */
  accessDoors?: boolean;
}) {
  const { t, locale } = useLanguage();
  const pathname = usePathname();
  const who = useSignedInSeen();
  const english = (key: MessageKey) =>
    locale !== defaultLocale && t(key) === translate(defaultLocale, key) ? 'en' : undefined;
  const word = (key: MessageKey) => <span lang={english(key)}>{t(key)}</span>;
  const faqs = faqRow.title;
  // A link on the home page opens what hides its target, then takes focus there.
  const home = (id: string) => () => {
    if (pathname === '/') revealThenFocus(id);
  };
  const quietLink = (href: string) => {
    const found = links.find((link) => link.href === href);
    if (!found) return null;
    const key = !realUse && found.testKey ? found.testKey : found.key;
    return (
      <li key={href}>
        <Link prefetch={false} href={accessDoors ? (doorFor[href] ?? href) : href}>
          {t(key)}
        </Link>
      </li>
    );
  };
  const privacy = links.find((link) => link.href === '/privacy');
  return (
    <footer className="guide-footer guide-footer-pack">
      <div className="gfp-top">
        <div className="gfp-brand">
          <Link prefetch={false} className="guide-footer-wordmark" href="/">
            <BrandLockup />
            <span className="sr-only">Corridra</span>
          </Link>
          <p className="gfp-eyebrow">{t('home.eyebrow')}</p>
        </div>
        <nav className="gfp-groups" aria-label={t('footer.nav')}>
          <details className="gfp-group" open>
            <summary>{word(v43('foot.solutions'))}</summary>
            <div className="gfp-body">
              <h2 className="gfp-title">{word(v43('foot.solutions'))}</h2>
              <ul>
                {solutionRows.map(({ id, href, title }) => (
                  <li key={id}>
                    <Link prefetch={false} href={href} onClick={home(id)}>
                      <span lang={english(title)}>
                        <PlaceWords text={t(title)} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="gfp-sub">{word(v43('menu.more'))}</p>
              <ul className="gfp-quiet">{quiet.map(quietLink)}</ul>
            </div>
          </details>
          <details className="gfp-group">
            <summary>{word(v43('foot.explore'))}</summary>
            <div className="gfp-body">
              <h2 className="gfp-title">{word(v43('foot.explore'))}</h2>
              <ul>
                {explore.map(({ href, key }) => (
                  <li key={href}>
                    <Link prefetch={false} href={href}>
                      {t(key)}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link prefetch={false} href={faqRow.href} onClick={home(faqRow.id)}>
                    {word(faqs)}
                  </Link>
                </li>
              </ul>
              <ul className="gfp-quiet">{exploreQuiet.map(quietLink)}</ul>
            </div>
          </details>
        </nav>
        {pathname?.startsWith('/operator/view-as') ? null : (
          <section className="gfp-access" aria-labelledby="gfp-access-title">
            <h2 id="gfp-access-title" className="gfp-title">
              {word(v43('foot.access'))}
            </h2>
            {who ? (
              <Link
                prefetch={false}
                className="button-secondary"
                href={who === 'staff' ? '/operator' : '/account'}
              >
                {t('footer.openWorkspace')}
              </Link>
            ) : (
              <>
                <ul>
                  {accessDoors ? (
                    accessDoorList.map((door) => (
                      <li key={door.id}>
                        <Link
                          prefetch={false}
                          href={door.href}
                          aria-current={pathname === door.href ? 'page' : undefined}
                        >
                          <span lang="en">{door.title}</span>
                        </Link>
                      </li>
                    ))
                  ) : (
                    <>
                      <li>
                        <Link prefetch={false} href="/account">
                          {word(v43('foot.customer'))}
                        </Link>
                      </li>
                      <li>
                        <Link prefetch={false} href="/operator">
                          {word(v43('foot.team'))}
                        </Link>
                      </li>
                      <li>
                        <Link prefetch={false} href="/contributor">
                          {word(v43('foot.helper'))}
                        </Link>
                      </li>
                    </>
                  )}
                  <li>
                    <Link prefetch={false} href="/workspace">
                      {t('footer.openWorkspace')}
                    </Link>
                  </li>
                </ul>
                <p className="gfp-note">{word(v43('foot.access.note'))}</p>
              </>
            )}
          </section>
        )}
      </div>
      <div className="guide-footer-bottom gfp-legal">
        <span className="guide-footer-copy">© 2026 Corridra</span>
        {privacy ? (
          <Link prefetch={false} href="/privacy">
            {t(!realUse && privacy.testKey ? privacy.testKey : privacy.key)}
          </Link>
        ) : null}
        <Link prefetch={false} href="/corridors/bangladesh-china">
          <span lang={english(v43('foot.guide'))}>
            <PlaceWords text={t(v43('foot.guide'))} />
          </span>
        </Link>
        <span className="guide-footer-private">{t('footer.private')}</span>
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
