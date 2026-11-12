'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FactLabel, NotConfirmedLabel } from './fact-label';
import { LanguageSwitcher } from './language-switcher';
import { useT } from './language-provider';
import { BrandLockup } from './site-header';
import { isQuiet, useSignedInSeen } from './use-signed-in';
import type { MessageKey } from '../lib/i18n/messages';
import './site-footer.css';

type FooterLink = {
  href: string;
  key: MessageKey;
  /** The words shown while real use is off, so the notice is never called more than it is. */
  testKey?: MessageKey;
};

/**
 * The footer's link groups, Option B (owner decision of 12 November 2026, locked mockups revision 2): three family
 * tiles of unequal width (Buy Abroad leads, then Groups and Trips, then Sell and Expand), each with a small dot, and
 * the four Corridra links as one inline row. The same 16 destinations as the Ledger footer it replaces, each once.
 * The page is built in English; the language is applied after load.
 */
type FooterGroup = {
  title: MessageKey;
  family?: 'buy' | 'trips' | 'sell';
  links: readonly FooterLink[];
};
export const footerGroups: readonly FooterGroup[] = [
  {
    title: 'footer.group.buy',
    family: 'buy',
    links: [
      { href: '/source', key: 'way.source' },
      { href: '/machinery', key: 'way.machinery' },
      { href: '/corridors/bangladesh-china', key: 'footer.link.china' },
      { href: '/corridors#mission-example', key: 'footer.link.sample' },
    ],
  },
  {
    title: 'footer.group.trips',
    family: 'trips',
    links: [
      { href: '/trade-missions', key: 'way.tradeMissions' },
      { href: '/business-trips', key: 'way.businessTrips' },
      { href: '/institutions', key: 'footer.institutions' },
      { href: '/network', key: 'footer.link.network' },
    ],
  },
  {
    title: 'footer.group.sell',
    family: 'sell',
    links: [
      { href: '/sell', key: 'way.sell' },
      { href: '/enter-market', key: 'way.enterMarket' },
      { href: '/corridors/bangladesh-spain', key: 'footer.link.spain' },
      { href: '/corridors', key: 'footer.link.routes' },
    ],
  },
  {
    title: 'footer.companyLabel',
    links: [
      { href: '/how-it-works', key: 'footer.link.howItWorks' },
      { href: '/about', key: 'footer.about' },
      { href: '/trust', key: 'footer.trust' },
      { href: '/privacy', key: 'footer.link.privacy', testKey: 'footer.link.privacyTest' },
    ],
  },
];

export function SiteFooterView({ realUse }: { realUse: boolean }) {
  const t = useT();
  // The public header has already asked who is signed in; a signed-in person is never offered sign-in here.
  const who = useSignedInSeen();
  // The staff customer preview is inert and offers no account actions (the header hides them there too).
  const pathname = usePathname();
  const preview = isQuiet(pathname);
  // The request page is a form with a length budget, so its footer is the compact one: the same links, actions and
  // trust words, with the trust legend folded (S13 under the S5 brief, owner confirmed, 9 November 2026, relayed by
  // the conductor: "proceed with /plan proposal"). Every other page keeps the full footer.
  const compact = pathname === '/plan';
  // Folded, the summary carries the legend's own opening words, so the body does not say them twice.
  const trust = (
    <>
      <div className="guide-footer-legend">
        {compact ? null : <span>{t('footer.facts')}</span>}
        <FactLabel label="Self-declared" english />
        <FactLabel label="Evidence available" english />
        <FactLabel label="Verified" english />
        <NotConfirmedLabel />
      </div>
      <Link prefetch={false} href="/trust">
        {t('footer.factsMore')}
      </Link>
    </>
  );
  return (
    <footer className={compact ? 'guide-footer guide-footer-compact' : 'guide-footer'}>
      <div className="guide-footer-top">
        <div className="guide-footer-brand">
          <Link prefetch={false} className="guide-footer-wordmark" href="/">
            <BrandLockup />
            <span className="sr-only">Corridra</span>
          </Link>
          <p className="guide-footer-promise">{t('footer.tagline')}</p>
          {preview ? null : (
            <div className="guide-footer-actions">
              <Link prefetch={false} className="primary-link" href="/plan">
                {t('header.start')}
              </Link>
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
                  <Link prefetch={false} className="button-secondary" href="/signin">
                    {t('footer.signIn')}
                  </Link>
                  <p className="guide-footer-already">
                    {t('footer.already')}{' '}
                    <Link prefetch={false} href="/workspace">
                      {t('footer.openWorkspace')}
                    </Link>
                  </p>
                </>
              )}
            </div>
          )}
        </div>
        {/* One copy of each link. On a phone each group is a disclosure and Buy Abroad starts open (not in the
            compact footer of the request page, which keeps its length budget); from 701 px every
            group shows open: the three family tiles, then the Corridra links as one row. */}
        <nav className="guide-footer-groups" aria-label={t('footer.nav')}>
          <div className="guide-footer-families">
            {footerGroups
              .filter((group) => group.family)
              .map((group, index) => (
                <FooterGroupBox
                  key={group.title}
                  group={group}
                  open={!compact && index === 0}
                  realUse={realUse}
                />
              ))}
          </div>
          {footerGroups
            .filter((group) => !group.family)
            .map((group) => (
              <FooterGroupBox key={group.title} group={group} open={false} realUse={realUse} />
            ))}
        </nav>
      </div>
      {compact ? (
        <details className="guide-footer-trust guide-footer-trust-fold">
          <summary>{t('footer.facts')}</summary>
          <div className="guide-footer-trust-body">{trust}</div>
        </details>
      ) : (
        <div className="guide-footer-trust">{trust}</div>
      )}
      <div className="guide-footer-bottom">
        <span className="guide-footer-copy">© 2026 Corridra</span>
        <span className="guide-footer-private">{t('footer.private')}</span>
        <span className="guide-footer-routes">{t('footer.routes')}</span>
        <LanguageSwitcher />
      </div>
    </footer>
  );
}

function FooterGroupBox({
  group,
  open,
  realUse,
}: {
  group: FooterGroup;
  open: boolean;
  realUse: boolean;
}) {
  const t = useT();
  const { title, family, links } = group;
  return (
    <details
      className={family ? 'guide-footer-details' : 'guide-footer-details guide-footer-corp'}
      data-family={family}
      open={open || undefined}
    >
      <summary>{t(title)}</summary>
      <div className="guide-footer-group">
        <h2 className="guide-footer-title">{t(title)}</h2>
        <ul>
          {links.map(({ href, key, testKey }) => (
            <li key={href}>
              <Link prefetch={false} href={href}>
                {t(!realUse && testKey ? testKey : key)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
