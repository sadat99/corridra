'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FactLabel, NotConfirmedLabel } from './fact-label';
import { LanguageSwitcher } from './language-switcher';
import { useT } from './language-provider';
import { doorFor, footerGroups } from './site-footer-view';
import { isQuiet, useSignedInSeen, useSignedInSettled } from './use-signed-in';
import { accessDoors as accessDoorList } from '../lib/access-doors';
import './site-footer-v44.css';

// The footer of the home page of 28 November 2026 (owner canvas board, home v4.4), on every page (owner, 28 Nov 2026:
// "new home footer should across full site by replacing existing one"). It keeps what the footers before it offered:
// every destination once (the same groups as the Option B footer, with the notice named as the test notice while real
// use is off, and the network link going to its access door while the doors are on), the sign-in and workspace
// buttons, the three access doors for a signed-out visitor, the trust legend with How We Label Facts, the privacy
// line, the copyright and the language. Three shapes: the full one on public pages; on the request page the link
// groups fold into one disclosure so the page keeps its length; inside a signed-in workspace the quiet line of before
// (How We Label Facts, the copyright, the privacy notice) with the language.
export function SiteFooterV44({
  realUse,
  accessDoors = false,
  workspace = false,
}: {
  realUse: boolean;
  /** CORRIDRA_UX_ACCESS_DOORS: a signed-out visitor sees the three doors, and the network link goes to its door. */
  accessDoors?: boolean;
  /** A page inside a signed-in workspace (the shells switch is on and the shell is one of the signed-in ones). */
  workspace?: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const who = useSignedInSeen();
  const known = useSignedInSettled();
  const preview = isQuiet(pathname);
  const compact = pathname === '/plan';
  const doors = accessDoors && !workspace && !compact && !preview && !who;
  // One copy of each link. On a phone each group is a native disclosure (closed, so the page keeps its length); from
  // 701 px every group shows open and its summary is hidden, as in the footer before. Where the browser cannot force a
  // closed group open the groups stay collapsible at every width.
  const groups = (
    <nav className="hv7-footer-nav" aria-label={t('footer.nav')}>
      {footerGroups.map((group) => (
        <details key={group.title} className="hv7-footer-group">
          <summary>{t(group.title)}</summary>
          <div>
            <h2>{t(group.title)}</h2>
            <ul>
              {group.links.map(({ href, key, testKey }) => (
                <li key={href}>
                  <Link prefetch={false} href={accessDoors ? (doorFor[href] ?? href) : href}>
                    {t(!realUse && testKey ? testKey : key)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ))}
    </nav>
  );
  if (workspace)
    return (
      <footer className="hv7-footer hv7-footer-quiet" data-footer="v44">
        <Link prefetch={false} href="/trust">
          {t('footer.factsMore')}
        </Link>
        <span>© 2026 Corridra</span>
        <Link prefetch={false} href="/privacy">
          {realUse ? t('footer.privacy') : t('footer.privacyTest')}
        </Link>
        <LanguageSwitcher />
      </footer>
    );
  return (
    <footer className="hv7-footer" data-footer="v44" data-compact={compact ? '' : undefined}>
      <div className="hv7-footer-top">
        <div className="hv7-footer-brand">
          <Link prefetch={false} href="/" className="hv7-footer-logo">
            <Image
              src="/brand/corridra-lockup-horizontal-cobalt.svg"
              alt="Corridra"
              width={1200}
              height={160}
              unoptimized
            />
          </Link>
          <p className="hv7-footer-promise">
            {t('footer.tagline')}
            <br />
            {t('footer.private')}
          </p>
          {preview || doors ? null : (
            <div className="hv7-footer-actions">
              {who ? (
                <Link
                  prefetch={false}
                  className="hv7-footer-button"
                  href={who === 'staff' ? '/operator' : '/account'}
                >
                  {t('footer.openWorkspace')}
                </Link>
              ) : (
                <>
                  <Link prefetch={false} className="hv7-footer-button" href="/signin">
                    {t('footer.signIn')}
                  </Link>
                  <p>
                    {t('footer.already')}{' '}
                    <Link prefetch={false} href="/workspace">
                      {t('footer.openWorkspace')}
                    </Link>
                  </p>
                </>
              )}
            </div>
          )}
          {doors ? (
            <section
              className="hv7-footer-access"
              data-pending={known ? undefined : 'true'}
              lang="en"
              aria-labelledby="hv7-footer-access-title"
            >
              <h2 id="hv7-footer-access-title">Find your way in.</h2>
              <ul>
                {accessDoorList.map((door) => (
                  <li key={door.id}>
                    <Link
                      prefetch={false}
                      href={door.href}
                      aria-current={pathname === door.href ? 'page' : undefined}
                    >
                      {door.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        {compact ? (
          <details className="hv7-footer-fold">
            <summary>{t('home.v44.footer.more')}</summary>
            {groups}
          </details>
        ) : (
          groups
        )}
      </div>
      <div className="hv7-footer-trust">
        {compact ? null : <span>{t('footer.facts')}</span>}
        <FactLabel label="Self-declared" english />
        <FactLabel label="Evidence available" english />
        <FactLabel label="Verified" english />
        <NotConfirmedLabel />
        <Link prefetch={false} href="/trust">
          {t('footer.factsMore')}
        </Link>
      </div>
      <div className="hv7-footer-bottom">
        <span>© 2026 Corridra</span>
        {compact ? null : <span>{t('footer.routes')}</span>}
        <LanguageSwitcher />
      </div>
    </footer>
  );
}
