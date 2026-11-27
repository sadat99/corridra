'use client';

import { useEffect, useState } from 'react';
import { PlaceWords } from './place-words';
import { DotMap } from './home-v44-dotmap';
import { useT } from './language-provider';
import { useHomeV44Motion } from './home-v44-motion';
import { Eyebrow } from './ux/example-tag';
import { v43 } from '../lib/home-v43-data';

// Home page v4.4 hero (owner, 27 Nov 2026, decision 4): centred, text only, on a soft arc; the first word of the
// second line is outlined. The words are the v4.3 words, unchanged. "Talk to a Person" shows only where the support
// number is set, as everywhere else. Nothing moves. "Start a Request" is a hash link, as in v4.3: it works before the
// page is ready and then moves focus to the route choice.
export function HomeV44Hero() {
  const t = useT();
  useHomeV44Motion();
  // Pause Motion stops every travelling dot and pulse of the page's maps; it is the page's one motion control.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (paused) root.setAttribute('data-hv44-paused', '');
    else root.removeAttribute('data-hv44-paused');
    return () => root.removeAttribute('data-hv44-paused');
  }, [paused]);
  const [first = '', ...rest] = t(v43('hero.title.b')).split(' ');
  return (
    <section className="hv43-hero hv44-hero" id="hero" aria-labelledby="home-title">
      <div className="hv44-hero-map" aria-hidden="true">
        <DotMap
          view="120 10 560 230"
          fill
          routes={['EU', 'US', 'AU', 'CN', 'AE']}
          pins={['EU', 'US', 'AU', 'CN', 'AE']}
        />
      </div>
      <div className="hv43-hero-text hv44-hero-text">
        <Eyebrow>{t('home.eyebrow')}</Eyebrow>
        <h1 id="home-title">
          {t(v43('hero.title.a'))}{' '}
          <em>
            <span className="hv44-outline">{first}</span>
            {rest.length ? ` ${rest.join(' ')}` : ''}
          </em>
        </h1>
        <p className="hv43-lead">
          <PlaceWords text={t(v43('hero.lead'))} />
        </p>
        <div className="hv43-actions hv44-actions">
          <a className="primary-link" href="#brief" id="home-start" data-start-action>
            {t(v43('hero.start'))}
          </a>
          <a className="text-link" href="#example">
            {t(v43('hero.example'))}
          </a>
        </div>
      </div>
      <button
        type="button"
        className="hv44-pause"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
      >
        {t(paused ? 'home.v44.motion.play' : 'home.v44.motion.pause')}
      </button>
    </section>
  );
}
