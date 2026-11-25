'use client';

import Link from 'next/link';
import { HomeJobs } from './home-jobs';
import type { Shown } from './home-routes';
import { TalkLink } from './home-talk';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { StartBar } from './ux/start-bar';
import type { HomeRoutesKey } from '../lib/home-routes-keys';

// The close of the home page (board 3c): the line follows the chosen route, only true risk reversal, the one first
// action again (with Talk when the support number is set), then the three job links (P-07). Below it, on a phone,
// the shared start bar (one action and its reassurance line): shown once the hero has scrolled away, hidden wherever
// the page shows its own actions.
const key = (name: string) => name as HomeRoutesKey;
/** Where the page shows its own action, the phone start bar steps aside. */
// The section actions are quiet text links (one primary on the page, #home-start); each is marked so the bar still
// steps aside beside it.
const hideStartBarAt = [
  'main .primary-link:not(.ux-start-bar .primary-link)',
  'main [data-start-action]',
  '#final',
  'footer',
];

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
    china: 'home.tr.fn.title.china',
    sell: 'home.tr.fn.title.sell',
    delegation: 'home.tr.fn.title.delegation',
    other: 'home.tr.fn.title.other',
  };
  return (
    <>
      <section className="tr-section tr-navy" id="final" aria-labelledby="final-title">
        <Eyebrow>{t('home.tr.fn.eyebrow')}</Eyebrow>
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
          <Link
            prefetch={false}
            data-start-action
            className="ac1-quiet tr-light-link"
            href={href}
            id="final-start"
          >
            {cta}
          </Link>
          <TalkLink href={whatsapp} className="secondary-link tr-on-navy" />
        </div>
        <p className="tr-jobs-lead">{t('home.tr.fn.jobs')}</p>
        <HomeJobs className="tr-jobs-quiet" quiet />
        <Link prefetch={false} className="ac1-quiet tr-light-link" href="/plan">
          {t('home.else')}
        </Link>
      </section>
      <StartBar
        href={href}
        label={cta}
        note={t('home.b3.mbar.note')}
        name={t('home.b3.mbar')}
        after="hero"
        hideAt={hideStartBarAt}
        watchKey={shown}
      />
    </>
  );
}
