'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HomeBrief, type GoalKey } from './home-brief';
import { FaqSection, RoutesSection, TrustSection } from './home-more';
import { China, ctaWords, Delegation, goalFor, Other, type Shown } from './home-routes';
import { HomeSell } from './home-sell';
import { HomeShared } from './home-shared';
import { HomeV42Choice } from './home-v42-choice';
import { HomeV42Hero } from './home-v42-hero';
import { HowTile, PeopleTile, PlainLimits, RulesTile } from './home-v42-parts';
import { useLanguage } from './language-provider';
import type { MessageKey } from '../lib/i18n/messages';
import { routeHref, type MarketKey, type RouteKey } from '../lib/home-routes-data';
import './home-v42.css';

// The home page v4.2, shown only while CORRIDRA_UX_HOME_V42 is exactly "true" (owner, 25 Nov 2026: "lock this v4.2";
// docs/revamp/specs/ui-ux-v4-2.md). Order: the navy hero with the route map; "Which way is your business moving?"; the
// chosen route, opened directly under the choice and only once a door is chosen, then the request brief (always); How
// it works, Trust (with the history record) and Who it is for as tiles; the route statuses; Straight answers; Plain
// limits; the live closing band. The words, the four doors as one radio group, the Start a Request link, the worked
// examples (each tagged Example, sending nothing) and the request brief are the live ones. The page sends nothing until
// /plan.
const showingText: Record<Shown, MessageKey> = {
  none: 'home.tr.bar.none',
  china: 'home.tr.bar.china',
  sell: 'home.tr.bar.sell',
  delegation: 'home.tr.bar.delegationText',
  other: 'home.tr.bar.otherText',
};

export function HomeV42({ whatsapp = null }: { whatsapp?: string | null }) {
  const { t } = useLanguage();
  const [shown, setShown] = useState<Shown>('none');
  const [opened, setOpened] = useState<RouteKey | null>(null);
  const [market, setMarket] = useState<MarketKey>('eu');
  const [marketPicked, setMarketPicked] = useState(false);
  const [goal, setGoal] = useState<GoalKey | null>(null);
  const [goalTouched, setGoalTouched] = useState(false);
  const route = shown === 'none' ? null : shown;
  const href = route ? routeHref[route] : '/plan';
  const choose = (next: Shown, fromDoor = false) => {
    setShown(next);
    setOpened(fromDoor && next !== 'none' ? next : null);
    if (next !== 'none' && !goalTouched) setGoal(goalFor[next]);
  };
  return (
    <div className="hv42">
      <HomeV42Hero />
      <HomeV42Choice
        shown={shown}
        opened={opened}
        href={href}
        cta={t(ctaWords[shown])}
        whatsapp={whatsapp}
        onChoose={(r) => choose(r, true)}
      />

      {route ? (
        <div className="hv42-reveal" id="reveal">
          <div className="tr-bar">
            <p className="tr-bar-label" aria-live="polite">
              <span className="label">{t('home.tr.bar.showing')}</span> {t(showingText[shown])}
            </p>
            <div className="tr-bar-buttons" role="group" aria-label={t('home.tr.bar.aria')}>
              {/* All Routes closes the opened route again (a radio cannot be un-chosen). The bar goes with it, so focus
                  moves to the first action rather than falling to the page (WCAG 2.4.3). */}
              <button
                type="button"
                aria-pressed={false}
                onClick={() => {
                  choose('none');
                  requestAnimationFrame(() => document.getElementById('home-start')?.focus());
                }}
              >
                {t('home.tr.bar.all')}
              </button>
              {(['china', 'sell', 'delegation', 'other'] as const).map((r) => (
                <button key={r} type="button" aria-pressed={shown === r} onClick={() => choose(r)}>
                  {t(`home.tr.bar.${r}` as MessageKey)}
                </button>
              ))}
            </div>
          </div>
          {route === 'china' ? <China /> : null}
          {route === 'sell' ? (
            <HomeSell
              market={market}
              onMarket={(m) => {
                setMarket(m);
                setMarketPicked(true);
              }}
            />
          ) : null}
          {route === 'delegation' ? <Delegation whatsapp={whatsapp} /> : null}
          {route === 'other' ? <Other whatsapp={whatsapp} /> : null}
        </div>
      ) : null}
      {/* The request brief is always on the page, as on the live home; it follows the chosen route. */}
      <HomeBrief
        route={route}
        goal={goal}
        onGoal={(g) => {
          setGoal(g);
          setGoalTouched(true);
        }}
        market={marketPicked ? market : null}
        whatsapp={whatsapp}
      />

      <div className="hv42-bento">
        <HowTile />
        <div className="hv42-trust">
          <TrustSection>
            <div className="tr-proof">
              <Link prefetch={false} className="ac1-quiet tr-light-link" href="/trust">
                {t('home.facts.more')}
              </Link>
            </div>
          </TrustSection>
        </div>
        <PeopleTile />
        <RulesTile />
      </div>

      <RoutesSection
        mine={route === 'delegation' ? null : route}
        flags
        links={false}
        readyLead={t('home.b3.rs.ready')}
        v42
        limits={false}
      />
      <FaqSection openKeys={[3, 8, 4, 6]} />
      <PlainLimits />

      <HomeShared shown={shown} href={href} cta={t(ctaWords[shown])} whatsapp={whatsapp} />
    </div>
  );
}
