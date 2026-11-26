'use client';

import { CorridraIcon, type IconName } from './corridra-icon';
import { useT } from './language-provider';
import type { HomeRoutesKey } from '../lib/home-routes-keys';

// The home page v4.2 sections that are new arrangements of live words (owner, 25 Nov 2026: "option 3 for "How it
// works, on every route.", "Trust, on every route(black)", "who it is for", "Plain Limits(black)""). Every word is an
// existing key except the "Plain limits" eyebrow, which is the owner's own name for the section.
const key = (name: string) => name as HomeRoutesKey;
/** One owned icon per person, in the order of the live words (UI spec D3). */
export const personIcon: IconName[] = [
  'sell',
  'buy',
  'work',
  'company',
  'globe',
  'inbox',
  'people',
  'network',
];
/** Steps 8 to 13 are optional, the same rule as the live rail. */
const optional = (i: number) => i >= 7 && i <= 12;

function Steps({ from, to }: { from: number; to: number }) {
  const t = useT();
  return (
    <ol className="hv42-steps" start={from + 1}>
      {Array.from({ length: to - from }, (_, n) => from + n).map((i) => (
        <li key={i} className={optional(i) ? 'is-optional' : undefined}>
          <span className="hv42-step-no" aria-hidden="true">
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className="hv42-step-dot" aria-hidden="true" />
          <span className="hv42-step-name">
            {t(key(`home.tr.ms.s${i}`))}
            {optional(i) ? (
              <>
                <span className="sr-only"> ({t('home.tr.ms.optional')})</span>
                <span className="guide-tag hv42-step-tag" data-tone="unknown" aria-hidden="true">
                  {t('home.tr.ms.optional')}
                </span>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** How it works, on every route: the fourteen steps in two lists, optional steps dashed and named. */
export function HowTile() {
  const t = useT();
  return (
    <section className="hv42-tile" id="how" aria-labelledby="how-title">
      <p className="label ac1-rule">{t('home.tr.ms.eyebrow')}</p>
      <h2 id="how-title">{t('home.tr.ms.title')}</h2>
      <p className="tr-sub">{t('home.tr.ms.lead')}</p>
      <div className="hv42-step-lists" role="group" aria-label={t('home.tr.ms.list')}>
        <Steps from={0} to={7} />
        <Steps from={7} to={14} />
      </div>
      <p className="tr-small">{t('home.tr.ms.note')}</p>
    </section>
  );
}

/** The four rules that sit under How it works (live words, in a soft tile of their own). */
export function RulesTile() {
  const t = useT();
  return (
    <div className="hv42-tile is-soft hv42-rules">
      {[1, 2, 3, 4].map((n) => (
        <div key={n}>
          <strong>{t(key(`home.tr.nv.${n}`))}</strong>
          <span>{t(key(`home.tr.nv.${n}.text`))}</span>
        </div>
      ))}
    </div>
  );
}

/** Who it is for: the eight people as static cards, each with an owned icon and the full live promise (Conductor
 * decision D3: no "You give"). */
export function PeopleTile() {
  const t = useT();
  return (
    <section className="hv42-tile" id="who" aria-labelledby="who-title">
      <p className="label ac1-rule">{t('home.tr.pe.eyebrow')}</p>
      <h2 id="who-title">{t('home.tr.pe.title')}</h2>
      <ul className="hv42-people">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <strong className="hv42-person">
              <CorridraIcon name={personIcon[i]!} size={20} />
              {t(key(`home.tr.pe.${i}`))}
            </strong>
            <span>{t(key(`home.tr.pe.${i}.get`))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Plain limits: what Corridra is not, on the navy band (owner, 25 Nov 2026: "Plain Limits(black)"). */
export function PlainLimits() {
  const t = useT();
  return (
    <section className="tr-section tr-navy hv42-limits" id="limits" aria-labelledby="limits-title">
      <p className="label ac1-rule">{t('home.v42.not.eyebrow')}</p>
      <h2 id="limits-title">{t('home.tr.not.title')}</h2>
      <ul className="hv42-nots">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <li key={n}>
            <strong>{t(key(`home.tr.not.${n}`))}</strong>
            <span>{t(key(`home.tr.not.${n}.text`))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
