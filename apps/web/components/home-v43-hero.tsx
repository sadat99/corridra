'use client';

import Image from 'next/image';
import { PlaceWords } from './place-words';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { v43 } from '../lib/home-v43-data';
import { revealThenFocus } from '../lib/ux/anchor-focus';

// Home page v4.3 hero (owner, 26 Nov 2026, via the Guardian: "update as per attachment 100% correctly"): light, text
// first, the industrial photo beside it from 48 rem and below the text on a phone. The photo is decoration only
// (empty alt, hidden from assistive technology), shows no person and makes no claim; it loads first (`loading="eager"`,
// `fetchPriority="high"`: Next.js 16 deprecates `priority`). Nothing moves: no overlay, sweep,
// parallax or gradient. "Start a Request" is a hash link, so it works before the page is ready; once it is, it moves
// focus to the route choice.
export function HomeV43Hero() {
  const t = useT();
  return (
    <section className="hv43-hero" id="hero" aria-labelledby="home-title">
      <div className="hv43-hero-text">
        <Eyebrow>{t('home.eyebrow')}</Eyebrow>
        <h1 id="home-title">
          {t(v43('hero.title.a'))} <em>{t(v43('hero.title.b'))}</em>
        </h1>
        <p className="hv43-lead">
          <PlaceWords text={t(v43('hero.lead'))} />
        </p>
        <div className="hv43-actions">
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
      <figure className="hv43-photo" aria-hidden="true">
        <Image
          src="/corridra-industrial-hero.webp"
          alt=""
          width={1440}
          height={960}
          loading="eager"
          fetchPriority="high"
          sizes="(min-width: 80rem) 600px, (min-width: 48rem) 45vw, calc(100vw - 2rem)"
        />
      </figure>
    </section>
  );
}
