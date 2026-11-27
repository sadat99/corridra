'use client';

import type { Shown } from './home-routes';
import { DotMap } from './home-v44-dotmap';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { StartBar } from './ux/start-bar';
import { v43 } from '../lib/home-v43-data';

// Home page v4.4 close (design approved 27 Nov 2026): one light band, one line, the one Start a Request and the
// existing promise that nothing is sent until the visitor checks it, beside a small route map. The phone start bar is the one HomeShared uses.
const hideStartBarAt = [
  'main .primary-link:not(.ux-start-bar .primary-link)',
  'main [data-start-action]',
  '#final',
  'footer',
];

export function HomeV44Closing({
  shown,
  href,
  cta,
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
        <div className="hv44-closing-text">
          <Eyebrow>{t('home.v44.close.eyebrow')}</Eyebrow>
          <h2 id="final-title">
            {t('home.v44.close.a')} <span className="hv44-outline">{t('home.v44.close.b')}</span>{' '}
            {t('home.v44.close.c')}
          </h2>
          <div className="hv44-closing-actions">
            <a className="primary-link" href="#brief" id="final-start" data-start-action>
              {t(v43('hero.start'))}
            </a>
            <p className="hv44-closing-note">{t('home.tr.fn.r1')}</p>
          </div>
        </div>
        <div className="hv44-closing-map" aria-hidden="true">
          <DotMap view="360 50 260 140" routes={['CN']} pins={['CN']} />
        </div>
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
