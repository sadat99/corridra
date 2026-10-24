'use client';

import Link from 'next/link';
import { useT } from './language-provider';
import type { MessageKey } from '../lib/i18n/messages';
import { waysToWork } from './ways-to-work';

/** The footer's links and words. The page is built in English; the language is applied after load. */
/** The header already carries How it works and Routes, so the footer repeats neither. */
const company: readonly (readonly [string, MessageKey])[] = [
  ['/workspace', 'footer.start'],
  ['/corridors#mission-example', 'footer.sampleMission'],
  ['/trust', 'footer.trust'],
  ['/about', 'footer.about'],
  ['/network', 'footer.network'],
  ['/institutions', 'footer.institutions'],
];

export function SiteFooterView({ realUse }: { realUse: boolean }) {
  const t = useT();
  return (
    <footer className="guide-footer">
      <div className="guide-footer-top">
        <div className="guide-footer-brand">
          <Link prefetch={false} className="brand" href="/">
            Corridra
          </Link>
          <p>{t('footer.tagline')}</p>
          <span>{t('footer.directions')}</span>
        </div>
        <nav aria-label={t('footer.waysAria')}>
          <p className="label">{t('footer.waysLabel')}</p>
          {waysToWork.map(({ href, key }) => (
            <Link prefetch={false} key={href} href={href}>
              {t(key)}
            </Link>
          ))}
        </nav>
        <nav aria-label={t('footer.companyAria')}>
          <p className="label">{t('footer.companyLabel')}</p>
          {company.map(([href, key]) => (
            <Link prefetch={false} key={href} href={href}>
              {t(key)}
            </Link>
          ))}
        </nav>
      </div>
      <div className="guide-footer-bottom">
        <span>© 2026 Corridra</span>
        <span>
          <Link prefetch={false} href="/privacy">
            {realUse ? t('footer.privacy') : t('footer.privacyTest')}
          </Link>
        </span>
      </div>
    </footer>
  );
}
