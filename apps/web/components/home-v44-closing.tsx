'use client';

import Link from 'next/link';
import { HomeJobs } from './home-jobs';
import type { Shown } from './home-routes';
import { TalkLink } from './home-talk';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { StartBar } from './ux/start-bar';
import type { HomeRoutesKey } from '../lib/home-routes-keys';

// Home page v4.4 close: the same words as the v4.3 close (the line follows the chosen route, only true risk reversal,
// the one first action, Talk where the number is set, the three jobs) on a light band with the three jobs as cards,
// as in the approved page. The phone start bar is the one HomeShared uses.
const key = (name: string) => name as HomeRoutesKey;
const hideStartBarAt = [
  'main .primary-link:not(.ux-start-bar .primary-link)',
  'main [data-start-action]',
  '#final',
  'footer',
];
const finalTitle: Record<Shown, HomeRoutesKey> = {
  none: 'home.tr.fn.title.none',
  china: 'home.tr.fn.title.china',
  sell: 'home.tr.fn.title.sell',
  delegation: 'home.tr.fn.title.delegation',
  other: 'home.tr.fn.title.other',
};

export function HomeV44Closing({
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
  return (
    <>
      <section className="hv44-closing" id="final" aria-labelledby="final-title">
        <Eyebrow>{t('home.tr.fn.eyebrow')}</Eyebrow>
        <h2 id="final-title">{t(finalTitle[shown])}</h2>
        <div className="hv44-closing-lines">
          {[1, 2, 3].map((n) => (
            <p key={n}>
              <strong>{t(key(`home.tr.fn.r${n}`))}</strong>{' '}
              <span>{t(key(`home.tr.fn.r${n}.text`))}</span>
            </p>
          ))}
        </div>
        <div className="hv44-closing-actions">
          <Link
            prefetch={false}
            data-start-action
            className="primary-link"
            href={href}
            id="final-start"
          >
            {cta}
          </Link>
          <TalkLink href={whatsapp} />
        </div>
        <p className="label hv44-closing-lead">{t('home.tr.fn.jobs')}</p>
        <HomeJobs className="hv44-jobs" />
        <Link prefetch={false} className="text-link" href="/plan">
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
