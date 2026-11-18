'use client';

import Link from 'next/link';
import { Arrow } from './arrow';
import { HomeJobs } from './home-jobs';
import { useT } from './language-provider';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import type { Shown } from './home-routes';

// The closing section of the home page: the one first action again, the three job links and one short link to each
// page the long sections moved to (17 November 2026). LP2 (18 November 2026): the two assurances the hero already
// gives (nothing is sent, stop any time) are not repeated here; only the one the hero does not give stays.
const key = (name: string) => name as HomeRoutesKey;

export function HomeShared({ shown, href, cta }: { shown: Shown; href: string; cta: string }) {
  const t = useT();
  const finalTitle: Record<Shown, HomeRoutesKey> = {
    none: 'home.tr.fn.title.none',
    all: 'home.tr.fn.title.none',
    china: 'home.tr.fn.title.china',
    sell: 'home.tr.fn.title.sell',
    delegation: 'home.tr.fn.title.delegation',
    other: 'home.tr.fn.title.other',
  };
  return (
    <>
      <section className="tr-section tr-navy" id="final" aria-labelledby="final-title">
        <p className="label ac1-rule">{t('home.tr.fn.eyebrow')}</p>
        <h2 id="final-title">{t(finalTitle[shown])}</h2>
        <div className="tr-reverse">
          {[3].map((n) => (
            <div key={n}>
              <strong>{t(key(`home.tr.fn.r${n}`))}</strong>
              <span>{t(key(`home.tr.fn.r${n}.text`))}</span>
            </div>
          ))}
        </div>
        <Link prefetch={false} className="primary-link" href={href} id="final-start">
          {cta} <Arrow />
        </Link>
        <p className="tr-jobs-lead">{t('home.tr.fn.jobs')}</p>
        <HomeJobs className="ac1-jobs tr-jobs" />
        <Link prefetch={false} className="ac1-quiet tr-light-link" href="/plan">
          {t('home.else')} <Arrow />
        </Link>
        <ul className="tr-pointers">
          <li>
            <Link prefetch={false} className="tr-light-link" href="/how-it-works">
              {t('home.tr.more.how')} <Arrow />
            </Link>
          </li>
          <li>
            <Link prefetch={false} className="tr-light-link" href="/trust">
              {t('home.facts.more')} <Arrow />
            </Link>
          </li>
          <li>
            <Link prefetch={false} className="tr-light-link" href="/corridors">
              {t('home.other.link')} <Arrow />
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}
