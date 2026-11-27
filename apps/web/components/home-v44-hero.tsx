'use client';

import { PlaceWords } from './place-words';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { v43 } from '../lib/home-v43-data';
import { revealThenFocus } from '../lib/ux/anchor-focus';

// Home page v4.4 hero (owner, 27 Nov 2026, decision 4: the redesign homepage is kept): centred, text only, no photo.
// The words are the v4.3 words, unchanged, so nothing new needs a native review. Nothing moves. "Start a Request" is a
// hash link, as in v4.3: it works before the page is ready and then moves focus to the route choice.
export function HomeV44Hero() {
  const t = useT();
  return (
    <section className="hv43-hero hv44-hero" id="hero" aria-labelledby="home-title">
      <div className="hv43-hero-text hv44-hero-text">
        <Eyebrow>{t('home.eyebrow')}</Eyebrow>
        <h1 id="home-title">
          {t(v43('hero.title.a'))} <em>{t(v43('hero.title.b'))}</em>
        </h1>
        <p className="hv43-lead">
          <PlaceWords text={t(v43('hero.lead'))} />
        </p>
        <div className="hv43-actions hv44-actions">
          <a
            className="primary-link"
            href="#start"
            onClick={(event) => {
              event.preventDefault();
              revealThenFocus('home-route-group');
            }}
          >
            {t(v43('hero.start'))}
          </a>
          <a className="text-link" href="#example">
            {t(v43('hero.example'))}
          </a>
        </div>
      </div>
    </section>
  );
}
