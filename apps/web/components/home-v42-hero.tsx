'use client';

import { Flagged, type FlagCode } from './ux/flag';
import { useT } from './language-provider';
import type { HomeRoutesKey } from '../lib/home-routes-keys';

// Home page v4.2 (owner, 25 Nov 2026: "like option 2 for hero section"): the navy band keeps the live brand line,
// headline and lead word for word (the lead still names key Asian markets), and beside it a flat map of the open
// routes: Bangladesh joined to China, the EU, the UK, the US and Australia. Real flag files through the shared flag
// component and real words; the connectors are plain CSS rules with no meaning of their own, so screen readers hear
// only the names. No gradient, no glow, no sphere, no Key Asian Markets node (it is a region, not a place on a line).
const key = (name: string) => name as HomeRoutesKey;
const places: { code: FlagCode; short: HomeRoutesKey; full: HomeRoutesKey }[] = [
  { code: 'cn', short: key('home.country.cn'), full: key('home.country.cn') },
  { code: 'eu', short: key('home.tr.mk.eu'), full: key('home.tr.mk.eu.to') },
  { code: 'gb', short: key('home.tr.mk.gb'), full: key('home.tr.mk.gb.to') },
  { code: 'us', short: key('home.tr.mk.us'), full: key('home.tr.mk.us.to') },
  { code: 'au', short: key('home.tr.mk.au'), full: key('home.tr.mk.au.to') },
];

export function HomeV42Hero() {
  const t = useT();
  const name = `${t('home.country.bd')} ${t('home.b3.to')} ${places.map((p) => t(p.full)).join(', ')}`;
  return (
    <section className="hv42-top" id="hero" aria-labelledby="home-title">
      <div className="tr-hero hv42-hero">
        <div className="tr-hero-head hv42-hero-head">
          <p className="tr-brandline">{t('home.eyebrow')}</p>
          <h1 id="home-title">{t('home.title')}</h1>
          <p className="tr-lead">{t('home.tr.lead')}</p>
        </div>
        <figure className="hv42-map" aria-label={name}>
          <div className="hv42-map-body">
            <p className="hv42-map-from">
              <Flagged code="bd" size="row">
                {t('home.country.bd')}
              </Flagged>
            </p>
            <ul className="hv42-map-to">
              {places.map((p) => (
                <li key={p.code}>
                  <Flagged code={p.code} size="row">
                    {t(p.short)}
                  </Flagged>
                </li>
              ))}
            </ul>
          </div>
        </figure>
      </div>
    </section>
  );
}
