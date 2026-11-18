'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { Arrow } from './arrow';
import { FactLabel } from './fact-label';
import { ChoiceChip, ChoiceChipRow } from './ux/choice-chip';
import { Eyebrow } from './ux/example-tag';
import { useT } from './language-provider';
import { fill } from '../lib/i18n/fill';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import {
  briefHref,
  briefGoals,
  briefTimings,
  goalRoute,
  marketExamples,
  type GoalKey,
  type MarketKey,
  type RouteKey,
} from '../lib/home-routes-data';

export type { GoalKey };

// "Your first mission brief in 60 seconds" (board 3c). Three answers build a draft card that visibly belongs to the
// visitor. Nothing is sent from here: the one action opens the real request form (/plan) with the job chosen and the
// visitor's words in its notes field, where they read, change and send them. No fake Send button.
const key = (name: string) => name as HomeRoutesKey;
const needLimit = 600;

export function HomeBrief({
  route,
  goal,
  onGoal,
  market,
  whatsapp,
}: {
  /** The door chosen at the top, or null. */
  route: RouteKey | null;
  goal: GoalKey | null;
  onGoal: (goal: GoalKey) => void;
  /** The market chosen in Sell Abroad, or null when the visitor has not picked one. */
  market: MarketKey | null;
  whatsapp: string | null;
}) {
  const t = useT();
  const ids = useId();
  const [need, setNeed] = useState('');
  const [when, setWhen] = useState<number | null>(null);
  const trimmed = need.trim();
  const answered = (goal ? 1 : 0) + (trimmed ? 1 : 0) + (when ? 1 : 0);
  const routeText = (() => {
    if (!goal) return '';
    const kind = goalRoute[goal];
    if (kind !== 'sell') return t(key(`home.b3.br.route.${kind}`));
    return market
      ? fill(t('home.b3.br.route.sell'), { market: t(key(`home.b3.mkto.${market}`)) })
      : t('home.b3.br.route.sellAny');
  })();
  const whenText = when ? t(key(`home.b3.br.when.${when}`)) : '';
  const placeholder = goal
    ? fill(t(key(`home.b3.br.ph.${goal}`)), { city: marketExamples[market ?? 'eu'].city })
    : t('home.b3.br.ph.none');
  const note = [
    routeText ? `${t('home.b3.note.route')}: ${routeText}` : '',
    trimmed ? `${t('home.b3.note.need')}: ${trimmed}` : '',
    whenText ? `${t('home.b3.note.when')}: ${whenText}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const href = briefHref(goal, note);
  const shown = (value: string) =>
    value ? (
      value
    ) : (
      <span className="guide-tag" data-tone="unknown">
        {t('home.b3.br.ns')}
      </span>
    );
  return (
    <section className="tr-section tr-alt" id="brief" aria-labelledby="brief-title">
      <Eyebrow>{t('home.tr.br.eyebrow')}</Eyebrow>
      <h2 id="brief-title">{t('home.b3.br.title')}</h2>
      <p className="tr-sub">{t('home.b3.br.lead')}</p>
      <div className="tr-brief-grid">
        <div className="tr-panel tr-brief-form">
          <fieldset className="tr-brief-step">
            <legend>
              <span className="tr-n" aria-hidden="true">
                1
              </span>
              {t('home.tr.br.goals')}
            </legend>
            <ChoiceChipRow>
              {briefGoals.map((g) => (
                <ChoiceChip
                  key={g}
                  name="home-brief-goal"
                  id={`${ids}-goal-${g}`}
                  value={g}
                  checked={goal === g}
                  onChoose={() => onGoal(g)}
                  label={t(key(`home.tr.br.g.${g}`))}
                />
              ))}
            </ChoiceChipRow>
          </fieldset>
          <div className="tr-brief-step">
            <label className="tr-brief-q" htmlFor={`${ids}-need`}>
              <span className="tr-n" aria-hidden="true">
                2
              </span>
              {t('home.b3.br.need')}
            </label>
            <textarea
              id={`${ids}-need`}
              className="tr-brief-need"
              maxLength={needLimit}
              rows={4}
              value={need}
              placeholder={placeholder}
              aria-describedby={`${ids}-need-help`}
              onChange={(event) => setNeed(event.target.value)}
            />
            <p className="tr-small" id={`${ids}-need-help`}>
              {t('home.b3.br.need.help')}
            </p>
          </div>
          <fieldset className="tr-brief-step">
            <legend>
              <span className="tr-n" aria-hidden="true">
                3
              </span>
              {t('home.b3.br.when')}
            </legend>
            <ChoiceChipRow>
              {briefTimings.map((n) => (
                <ChoiceChip
                  key={n}
                  name="home-brief-when"
                  id={`${ids}-when-${n}`}
                  value={String(n)}
                  checked={when === n}
                  onChoose={() => setWhen(n)}
                  label={t(key(`home.b3.br.when.${n}`))}
                />
              ))}
            </ChoiceChipRow>
          </fieldset>
        </div>
        <div className="tr-brief-card" role="group" aria-labelledby={`${ids}-card`}>
          <p className="tr-stamp">{t('home.b3.br.stamp')}</p>
          <h3 className="tr-h3" id={`${ids}-card`}>
            {t('home.b3.br.card')}
          </h3>
          <div className="tr-meter">
            <span>{fill(t('home.b3.br.count'), { n: answered })}</span>
            <span className="tr-meter-bar" aria-hidden="true">
              <span data-answered={answered} />
            </span>
          </div>
          <dl className="tr-brief-dl" aria-live="polite">
            <div>
              <dt>{t('home.b3.br.dt.chosen')}</dt>
              <dd>{shown(route ? t(key(`home.tr.door.${route}.title`)) : '')}</dd>
            </div>
            <div>
              <dt>{t('home.b3.br.dt.goal')}</dt>
              <dd>{shown(goal ? t(key(`home.b3.br.goal.${goal}`)) : '')}</dd>
            </div>
            <div>
              <dt>{t('home.b3.br.dt.route')}</dt>
              <dd>{shown(routeText)}</dd>
            </div>
            <div>
              <dt>{t('home.b3.br.dt.need')}</dt>
              <dd className="tr-brief-words">
                {shown(trimmed.length > 280 ? `${trimmed.slice(0, 280)}...` : trimmed)}
              </dd>
            </div>
            <div>
              <dt>{t('home.b3.br.dt.when')}</dt>
              <dd>{shown(whenText)}</dd>
            </div>
            <div>
              <dt>{t('home.b3.br.dt.next')}</dt>
              <dd className="tr-brief-next">{t('home.b3.br.next')}</dd>
            </div>
          </dl>
          <p className="tr-brief-stated">
            <FactLabel label="Self-declared" english /> <span>{t('home.b3.br.stated')}</span>
          </p>
          <p className="tr-small">{t('home.b3.br.send')}</p>
          <div className="tr-brief-actions">
            <Link prefetch={false} className="primary-link" href={href} id="brief-start">
              {t('home.tr.cta.none')} <Arrow />
            </Link>
            {whatsapp ? (
              <a
                className="secondary-link"
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('home.b3.br.whatsapp')}
                <span className="sr-only"> {t('home.b3.talk.where')}</span>
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
