'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Arrow } from './arrow';
import { HomeJobs } from './home-jobs';
import type { Shown } from './home-routes';
import { TalkLink } from './home-talk';
import { useT } from './language-provider';
import type { HomeRoutesKey } from '../lib/home-routes-keys';

// The close of the home page (board 3c): the line follows the chosen route, only true risk reversal, the one first
// action again (with Talk when the support number is set), then the three job links (P-07). Below it, on a phone,
// the quick-start bar: shown once the hero has scrolled away, hidden wherever the page shows its own actions.
const key = (name: string) => name as HomeRoutesKey;

export function HomeShared({
  shown,
  href,
  cta,
  whatsapp,
}: {
  shown: Shown;
  href: string;
  cta: string;
  whatsapp: string | null;
}) {
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
          {[1, 2, 3].map((n) => (
            <div key={n}>
              <strong>{t(key(`home.tr.fn.r${n}`))}</strong>
              <span>{t(key(`home.tr.fn.r${n}.text`))}</span>
            </div>
          ))}
        </div>
        <div className="tr-actions">
          <Link prefetch={false} className="primary-link" href={href} id="final-start">
            {cta} <Arrow />
          </Link>
          <TalkLink href={whatsapp} className="secondary-link tr-on-navy" />
        </div>
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
      <QuickStart href={href} cta={cta} whatsapp={whatsapp} />
    </>
  );
}

/** The phone quick-start bar (board 3c, up to 760 px wide). It never covers the page's own actions or the footer. */
function QuickStart({
  href,
  cta,
  whatsapp,
}: {
  href: string;
  cta: string;
  whatsapp: string | null;
}) {
  const t = useT();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const watched = [
      document.getElementById('hero'),
      document.getElementById('brief-start')?.parentElement ?? null,
      document.getElementById('final'),
      document.querySelector('footer'),
    ].filter((el): el is HTMLElement => el !== null);
    const visible = new Map<Element, boolean>(watched.map((el) => [el, el.id === 'hero']));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target, entry.isIntersecting);
        setOn(![...visible.values()].some(Boolean));
      },
      { threshold: 0, rootMargin: '-64px 0px 0px 0px' },
    );
    for (const el of watched) observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="tr-mbar"
      role="group"
      aria-label={t('home.b3.mbar')}
      data-on={on ? 'true' : undefined}
      inert={!on}
    >
      <Link prefetch={false} className="primary-link" href={href}>
        {cta}
      </Link>
      <TalkLink href={whatsapp} short className="secondary-link tr-on-navy" />
    </div>
  );
}
