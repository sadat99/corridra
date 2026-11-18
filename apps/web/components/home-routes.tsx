'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { Arrow } from './arrow';
import { CorridraIcon } from './corridra-icon';
import { FactLabel, NotConfirmedLabel } from './fact-label';
import { HomeBrief, type GoalKey } from './home-brief';
import { FaqSection, MissionSection, People, RoutesSection, TrustSection } from './home-more';
import { DoorCard } from './ux/door-card';
import { ExampleTag, Eyebrow } from './ux/example-tag';
import { Flagged, type FlagCode } from './ux/flag';
import { RouteLine } from './home-route-line';
import { HomeSell } from './home-sell';
import { HomeShared } from './home-shared';
import { TalkLink } from './home-talk';
import { useLanguage } from './language-provider';
import { fill } from '../lib/i18n/fill';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import type { MessageKey } from '../lib/i18n/messages';
import {
  dhakaTime,
  programmeRows,
  quotes,
  routeHref,
  visitStops,
  type MarketKey,
  type QuoteKey,
  type RouteKey,
} from '../lib/home-routes-data';

// The home page as the owner's design board "Corridra Two Routes", revision 3c, in full (owner, 17 and 18 November
// 2026; LP3). The visitor picks a door; the headline becomes that route's proposition, its route opens below, the
// brief and the people follow the choice, and the first action becomes the real request for it. Every example is
// tagged Example and sends nothing. The only actions that leave the page are links to /plan and, when the owner has
// set a support number, WhatsApp.
export type Shown = 'none' | 'all' | RouteKey;
const key = (name: string) => name as HomeRoutesKey;
// Delivery codes and the trust name stay as written, outside the words (they are not translated).
const terms = {
  fob: quotes.a.delivery ?? '',
  cif: quotes.c.delivery ?? '',
  selfDeclared: 'Self-declared',
};
/** The person each door preselects in "Eight people" (board 3c): Importer, Exporter, Delegation leader. */
const personFor: Partial<Record<RouteKey, number>> = { china: 1, sell: 0, delegation: 6 };
/** The brief goal each door preselects. */
const goalFor: Record<RouteKey, GoalKey> = {
  china: 'china',
  sell: 'sell',
  delegation: 'delegation',
  other: 'other',
};
export const ctaWords: Record<Shown, MessageKey> = {
  none: 'home.tr.cta.none',
  all: 'home.tr.cta.none',
  china: 'home.tr.cta.china',
  sell: 'home.tr.cta.sell',
  delegation: 'home.tr.cta.delegation',
  other: 'home.tr.cta.other',
};

export function HomeRoutes({ whatsapp = null }: { whatsapp?: string | null }) {
  const { t, locale, offered, pages } = useLanguage();
  const [shown, setShown] = useState<Shown>('none');
  const [opened, setOpened] = useState<RouteKey | null>(null);
  const [market, setMarket] = useState<MarketKey>('eu');
  const [marketPicked, setMarketPicked] = useState(false);
  const [goal, setGoal] = useState<GoalKey | null>(null);
  const [person, setPerson] = useState(0);
  const route = shown === 'none' || shown === 'all' ? null : shown;
  const href = route ? routeHref[route] : '/plan';
  const choose = (next: Shown, fromDoor = false) => {
    setShown(next);
    setOpened(fromDoor && next !== 'all' && next !== 'none' ? next : null);
    if (next !== 'all' && next !== 'none') {
      setGoal(goalFor[next]);
      const p = personFor[next];
      if (p !== undefined) setPerson(p);
    }
  };
  const show = (r: RouteKey) => shown === r || (shown === 'all' && r !== 'other');
  const open = (r: Shown) => {
    choose(r);
    // The section is drawn on the next frame, so the move waits for it.
    requestAnimationFrame(() => {
      const target = document.getElementById(r === 'all' ? 'route-china' : `route-${r}`);
      target?.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
      target?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
  };
  const showingText: Record<Shown, MessageKey> = {
    none: 'home.tr.bar.none',
    all: 'home.tr.bar.allText',
    china: 'home.tr.bar.china',
    sell: 'home.tr.bar.sell',
    delegation: 'home.tr.bar.delegationText',
    other: 'home.tr.bar.otherText',
  };
  // The headline is the brand line until a door is chosen; then it is that route's own proposition (board 3c).
  const title = route ? t(key(`home.b3.hero.${route}.title`)) : t('home.title');
  const lead = route ? t(key(`home.b3.hero.${route}.sub`)) : t('home.tr.lead');
  const draft = pages && locale !== 'en' && offered.some((o) => o.code === locale && o.draft);
  return (
    <>
      <section className="tr-hero" id="hero" aria-labelledby="home-title">
        <div className="tr-hero-head">
          <p className="tr-brandline">{route ? t('home.title') : t('home.eyebrow')}</p>
          <h1 id="home-title">{title}</h1>
          <p className="tr-lead">{lead}</p>
          {draft ? (
            <p className="tr-draft" lang="en" dir="ltr">
              {t('home.b3.draft')}
            </p>
          ) : null}
        </div>
        <div className="tr-start">
          <div className="tr-start-actions">
            <Link prefetch={false} className="primary-link" href={href} id="home-start">
              {t(ctaWords[shown])} <Arrow />
            </Link>
            <TalkLink href={whatsapp} />
          </div>
          <ul className="ac1-calm">
            {(['account', 'send', 'stop'] as const).map((name) => (
              <li key={name}>
                <CorridraIcon name="check" size={16} />
                {t(`home.tr.assure.${name}` as MessageKey)}
              </li>
            ))}
          </ul>
          {shown === 'none' ? <p className="tr-hint">{t('home.tr.hint')}</p> : null}
          <p className="tr-feedback" aria-live="polite">
            {opened ? (
              <>
                {fill(t('home.tr.opened'), { route: t(key(`home.tr.door.${opened}.title`)) })}{' '}
                <a className="ac1-quiet" href={`#route-${opened}`}>
                  {t('home.tr.goto')}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <fieldset className="tr-doors">
          <legend>{t('home.tr.q')}</legend>
          <p className="tr-doors-sub">{t('home.tr.q.sub')}</p>
          <div className="tr-doors-big">
            {(['china', 'sell'] as const).map((r) => (
              <Door key={r} route={r} checked={shown === r} onChoose={() => choose(r, true)} big />
            ))}
          </div>
          <div className="tr-doors-small">
            {(['delegation', 'other'] as const).map((r) => (
              <Door key={r} route={r} checked={shown === r} onChoose={() => choose(r, true)} />
            ))}
          </div>
        </fieldset>
      </section>

      <div className="tr-bar">
        {/* The route state is for screen readers; the pressed button shows it on screen (LP2 finding). */}
        <p className="sr-only" aria-live="polite">
          {t('home.tr.bar.showing')} {t(showingText[shown])}
        </p>
        <div className="tr-bar-buttons" role="group" aria-label={t('home.tr.bar.aria')}>
          {(['china', 'sell', 'delegation', 'other', 'all'] as const).map((r) => (
            <button key={r} type="button" aria-pressed={shown === r} onClick={() => choose(r)}>
              {t(`home.tr.bar.${r}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      {shown === 'none' ? (
        <section className="tr-section tr-choose" id="pick" aria-labelledby="pick-title">
          <Eyebrow>{t('home.tr.pick.eyebrow')}</Eyebrow>
          <h2 id="pick-title">{t('home.tr.pick.title')}</h2>
          <ol className="tr-three">
            {[1, 2, 3].map((n) => (
              <li key={n}>
                <span className="tr-n" aria-hidden="true">
                  {n}
                </span>
                <strong>{t(key(`home.tr.pick.${n}.title`))}</strong>
                <p>{t(key(`home.tr.pick.${n}.text`))}</p>
              </li>
            ))}
          </ol>
          <div className="tr-opens">
            {(['china', 'sell'] as const).map((r) => (
              <button key={r} type="button" onClick={() => open(r)}>
                <strong>{t(`home.tr.open.${r}` as MessageKey)}</strong>
                <span>{t(`home.tr.open.${r}.text` as MessageKey)}</span>
              </button>
            ))}
          </div>
          <div className="tr-more">
            <p>{t('home.tr.open.more')}</p>
            <button type="button" className="tr-linkbtn" onClick={() => open('delegation')}>
              {t('home.tr.open.delegation')}
            </button>
            <button type="button" className="tr-linkbtn" onClick={() => open('other')}>
              {t('home.tr.open.other')}
            </button>
            <button type="button" className="tr-linkbtn" onClick={() => open('all')}>
              {t('home.tr.open.everything')}
            </button>
          </div>
        </section>
      ) : null}

      {show('china') ? <China /> : null}
      {show('sell') ? (
        <HomeSell
          market={market}
          onMarket={(m) => {
            setMarket(m);
            setMarketPicked(true);
          }}
        />
      ) : null}
      {show('delegation') ? <Delegation whatsapp={whatsapp} /> : null}
      {shown === 'other' ? <Other whatsapp={whatsapp} /> : null}

      <MissionSection />
      <HomeBrief
        route={route}
        goal={goal}
        onGoal={setGoal}
        market={marketPicked ? market : null}
        whatsapp={whatsapp}
      />
      <TrustSection>
        <div className="tr-proof">
          <Link prefetch={false} className="secondary-link tr-on-navy" href="/trust">
            {t('home.facts.more')} <Arrow />
          </Link>
        </div>
      </TrustSection>
      <People current={person} onChange={setPerson} />
      <FaqSection />
      <RoutesSection mine={route === 'delegation' ? null : route} flags />

      <HomeShared shown={shown} href={href} cta={t(ctaWords[shown])} whatsapp={whatsapp} />
    </>
  );
}

function Door({
  route,
  checked,
  onChoose,
  big = false,
}: {
  route: RouteKey;
  checked: boolean;
  onChoose: () => void;
  big?: boolean;
}) {
  const t = useLanguage().t;
  return (
    <DoorCard
      className="tr-door"
      name="home-route"
      value={route}
      checked={checked}
      onChoose={onChoose}
      size={big ? 'big' : 'small'}
      side={big ? t(route === 'china' ? 'home.tr.side.supply' : 'home.tr.side.demand') : undefined}
      route={big ? <RouteLine route={route as 'china' | 'sell'} /> : undefined}
      title={t(key(`home.tr.door.${route}.title`))}
      text={t(key(`home.tr.door.${route}.text`))}
      picked={t('home.tr.selected')}
    />
  );
}

function Tests({ name, count = 4 }: { name: 'cn' | 'sl'; count?: number }) {
  const t = useLanguage().t;
  return (
    <div className="tr-tests">
      <p className="label">{t('home.tr.tests')}</p>
      <ul>
        {Array.from({ length: count }, (_, i) => (
          <li key={i}>{t(key(`home.tr.${name}.t${i + 1}`))}</li>
        ))}
      </ul>
    </div>
  );
}

function China() {
  const t = useLanguage().t;
  const [pick, setPick] = useState<QuoteKey | 'x' | null>(null);
  const [stop, setStop] = useState(1);
  const gz = visitStops[stop];
  const dh = dhakaTime(gz);
  const letters: QuoteKey[] = ['a', 'b', 'c'];
  return (
    <section className="tr-section tr-alt" id="route-china" aria-labelledby="china-title">
      <div className="tr-intro">
        <div>
          <Eyebrow>{t('home.tr.cn.eyebrow')}</Eyebrow>
          <p className="tr-side">
            <RouteLine route="china" />
          </p>
          <h2 id="china-title" tabIndex={-1}>
            {t('home.tr.cn.title')}
          </h2>
          <p className="tr-sub">{t('home.tr.cn.lead')}</p>
        </div>
        <Tests name="cn" />
      </div>

      <div className="tr-block">
        <h3 className="tr-h3" id="gaps">
          {t('home.tr.q.title')}
        </h3>
        <div className="tr-block-body">
          <p className="tr-sub">{t('home.tr.q.lead')}</p>
          <div className="tr-quotes">
            {letters.map((letter) => {
              const q = quotes[letter];
              const reveal = pick !== null;
              const ns = q.coverage.filter((c) => c[1] === 'ns').length;
              const out = q.coverage.filter((c) => c[1] === 'out').length;
              const word = {
                yes: 'home.tr.q.inPrice',
                out: 'home.tr.q.notInPrice',
                ns: 'home.tr.q.notStated',
              } as const;
              const installWords = {
                included: 'home.tr.q.included',
                notIncluded: 'home.tr.q.notIncluded',
                notConfirmed: 'home.tr.q.notConfirmed',
              } as const;
              return (
                <article
                  key={letter}
                  className={`tr-quote${pick === letter ? ' is-picked' : ''}`}
                  aria-labelledby={`quote-${letter}`}
                >
                  <header>
                    <strong id={`quote-${letter}`}>
                      {fill(t('home.tr.q.supplier'), { letter: letter.toUpperCase() })}
                    </strong>
                    <ExampleTag>{t('home.tr.q.example')}</ExampleTag>
                  </header>
                  <p className="tr-price">
                    <small>USD</small> {q.price}
                  </p>
                  <dl>
                    <div>
                      <dt>{t('home.tr.q.delivery')}</dt>
                      <dd>{q.delivery ?? <NotStated />}</dd>
                    </div>
                    <div>
                      <dt>{t('home.tr.q.install')}</dt>
                      <dd>
                        {q.install === 'notConfirmed' ? (
                          <NotConfirmedLabel />
                        ) : (
                          t(installWords[q.install])
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('home.tr.q.lead.time')}</dt>
                      <dd>{fill(t('home.tr.q.days'), { n: q.days })}</dd>
                    </div>
                  </dl>
                  <FactLabel label="Self-declared" english />
                  {reveal ? (
                    <div className="tr-reveal">
                      <p className="tr-gap">
                        {fill(t(ns === 1 ? 'home.tr.q.gap.one' : 'home.tr.q.gap.many'), { n: ns })}
                        <br />
                        {fill(t(out === 1 ? 'home.tr.q.gap.out.one' : 'home.tr.q.gap.out.many'), {
                          n: out,
                        })}
                      </p>
                      <p className="label">{t('home.tr.q.covers')}</p>
                      <ul className="tr-cover">
                        {q.coverage.map(([name, state]) => (
                          <li key={name} data-state={state}>
                            <span>{t(name)}</span>
                            <span>{t(word[state])}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="tr-verdict">{t(q.verdict)}</p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="tr-pick"
                    aria-pressed={pick === letter}
                    onClick={() => setPick(letter)}
                  >
                    {fill(t('home.tr.q.pick'), { letter: letter.toUpperCase() })}
                  </button>
                </article>
              );
            })}
          </div>
          <div className="tr-actions">
            <button
              type="button"
              className="tr-pick tr-pick-ghost"
              aria-pressed={pick === 'x'}
              onClick={() => setPick('x')}
            >
              {t('home.tr.q.unsure')}
            </button>
            {pick ? (
              <button type="button" className="tr-quiet-button" onClick={() => setPick(null)}>
                {t('home.tr.q.reset')}
              </button>
            ) : null}
          </div>
          <div className="tr-reaction" aria-live="polite">
            {pick ? (
              <>
                <p className="label">{t('home.tr.q.react.kicker')}</p>
                <p className="tr-reaction-title">
                  {fill(t(key(`home.tr.q.react.${pick}.title`)), {
                    price: pick === 'x' ? '' : `USD ${quotes[pick].price}`,
                  })}
                </p>
                <p>{fill(t(key(`home.tr.q.react.${pick}.body`)), terms)}</p>
                <p>
                  <strong>{t('home.tr.q.none')}</strong> {t('home.tr.q.ask')}
                </p>
                <ul>
                  {letters.map((l) => (
                    <li key={l}>{t(key(`home.tr.q.ask.${l}`))}</li>
                  ))}
                </ul>
                <p>{t('home.tr.q.keep')}</p>
                <Link prefetch={false} className="primary-link" href={routeHref.china}>
                  {t('home.tr.q.cta')} <Arrow />
                </Link>
              </>
            ) : null}
          </div>
          <p className="tr-rule">
            <ExampleTag>{t('home.tr.q.rule')}</ExampleTag>
            <span>
              <strong>{t('home.tr.q.rule.title')}</strong> {t('home.tr.q.rule.text')}
            </span>
          </p>
        </div>
      </div>
      <div className="tr-block">
        <h3 className="tr-h3" id="visit-title">
          {t('home.tr.visit.title')}
        </h3>
        <div className="tr-block-body">
          <p className="tr-sub">{t('home.tr.visit.lead')}</p>
          <div className="tr-day" role="group" aria-label={t('home.tr.visit.title')}>
            <div className="tr-day-head">
              <strong>{t('home.tr.visit.day')}</strong>
              <ExampleTag>{t('home.tr.q.example')}</ExampleTag>
            </div>
            <div className="tr-clocks">
              <Clock
                city={t('home.tr.visit.gz')}
                tz={t('home.tr.visit.gz.tz')}
                time={gz}
                flag="cn"
              />
              <Clock
                city={t('home.tr.visit.dh')}
                tz={t('home.tr.visit.dh.tz')}
                time={dh}
                flag="bd"
              />
            </div>
            <ol className="tr-stops" aria-label={t('home.tr.visit.stops')}>
              {visitStops.map((time, i) => (
                <li key={time}>
                  <button type="button" aria-pressed={stop === i} onClick={() => setStop(i)}>
                    <span className="tr-time">{time}</span>
                    <span>{t(key(`home.tr.visit.s${i}.title`))}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="tr-day-detail" aria-live="polite">
              <strong>
                {fill(t('home.tr.visit.at'), {
                  gz,
                  dh,
                  stop: t(key(`home.tr.visit.s${stop}.title`)),
                })}
              </strong>
              <p>{t(key(`home.tr.visit.s${stop}.text`))}</p>
            </div>
          </div>
          <p className="tr-small">{t('home.tr.visit.note')}</p>
        </div>
      </div>
      <div className="tr-block">
        <h3 className="tr-h3" id="comparable-title">
          {t('home.tr.comp.title')}
        </h3>
        <div className="tr-block-body">
          <ol className="tr-three">
            {[1, 2, 3].map((n) => (
              <li key={n}>
                <span className="tr-n" aria-hidden="true">
                  {n}
                </span>
                <strong>{t(key(`home.tr.comp.${n}.title`))}</strong>
                <p>{fill(t(key(`home.tr.comp.${n}.text`)), terms)}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <Link prefetch={false} className="primary-link" href={routeHref.china}>
        {t('home.tr.cta.china')} <Arrow />
      </Link>
    </section>
  );
}

function NotStated() {
  const t = useLanguage().t;
  return (
    <span className="guide-tag" data-tone="unknown">
      {t('home.tr.q.notStated')}
    </span>
  );
}

/** An analog face plus the time in digits, so the hands are never the only way to read it. */
function Clock({
  city,
  tz,
  time,
  flag,
}: {
  city: string;
  tz: string;
  time: string;
  flag: FlagCode;
}) {
  const t = useLanguage().t;
  const [h, m] = time.split(':').map(Number);
  const hands = {
    '--tr-hour': `${(h % 12) * 30 + m * 0.5}deg`,
    '--tr-minute': `${m * 6}deg`,
  } as CSSProperties;
  return (
    <div className="tr-clock">
      <div
        className="tr-face"
        role="img"
        aria-label={fill(t('home.tr.visit.clock'), { city, time })}
        style={hands}
      >
        <span className="tr-hand tr-hour" />
        <span className="tr-hand tr-minute" />
      </div>
      <div>
        <p className="tr-clock-city">
          <Flagged code={flag}>{city}</Flagged>
        </p>
        <p className="tr-clock-time">{time}</p>
        <p className="tr-small">{tz}</p>
      </div>
    </div>
  );
}

function Delegation({ whatsapp }: { whatsapp: string | null }) {
  const t = useLanguage().t;
  const stages = ['defined', 'matched', 'met', 'offers', 'followed'] as const;
  return (
    <section className="tr-section tr-alt" id="route-delegation" aria-labelledby="del-title">
      <Eyebrow>{t('home.tr.dl.eyebrow')}</Eyebrow>
      <h2 id="del-title" tabIndex={-1}>
        {t('home.tr.dl.title')}
      </h2>
      <p className="tr-sub">{t('home.tr.dl.lead')}</p>
      <div className="tr-block">
        <div className="tr-block-body">
          <div className="tr-scroll" tabIndex={0} role="region" aria-label={t('home.tr.dl.aria')}>
            <table className="tr-table">
              <thead>
                <tr>
                  <th scope="col">{t('home.tr.dl.col.company')}</th>
                  {stages.map((s) => (
                    <th scope="col" key={s}>
                      {t(`home.tr.dl.col.${s}` as MessageKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {programmeRows.map((row, i) => (
                  <tr key={i}>
                    <th scope="row">
                      <CorridraIcon name="lock" size={16} />{' '}
                      {fill(t('home.tr.dl.private'), { n: i + 1 })}
                    </th>
                    {row.map((done, j) => (
                      <td key={j}>
                        <span className={done ? 'tr-dot' : 'tr-dot is-open'} aria-hidden="true" />
                        <span className="sr-only">
                          {t(done ? 'home.tr.dl.done' : 'home.tr.dl.notYet')}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="tr-table-foot">
              <span>{t('home.tr.dl.total')}</span>
              <ExampleTag>{t('home.tr.q.example')}</ExampleTag>
            </div>
          </div>
          <p className="tr-small">{t('home.tr.dl.key')}</p>
          <div className="tr-two">
            <div>
              <strong>{t('home.tr.dl.sees')}</strong>
              <ul>
                {[1, 2, 3].map((n) => (
                  <li key={n}>{t(key(`home.tr.dl.sees.${n}`))}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>{t('home.tr.dl.not')}</strong>
              <ul>
                {[1, 2, 3].map((n) => (
                  <li key={n}>{t(key(`home.tr.dl.not.${n}`))}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div className="tr-actions">
        <Link prefetch={false} className="primary-link" href={routeHref.delegation}>
          {t('home.tr.dl.cta')} <Arrow />
        </Link>
        <TalkLink href={whatsapp} />
      </div>
    </section>
  );
}

function Other({ whatsapp }: { whatsapp: string | null }) {
  const t = useLanguage().t;
  return (
    <section className="tr-section tr-alt" id="route-other" aria-labelledby="oth-title">
      <div className="tr-other">
        <Eyebrow>{t('home.tr.ot.eyebrow')}</Eyebrow>
        <h2 id="oth-title" tabIndex={-1}>
          {t('home.tr.ot.title')}
        </h2>
        <p className="tr-sub">{t('home.tr.ot.lead')}</p>
        <div className="tr-actions">
          <Link prefetch={false} className="primary-link" href={routeHref.other}>
            {t('home.tr.ot.cta')} <Arrow />
          </Link>
          <TalkLink href={whatsapp} />
        </div>
      </div>
    </section>
  );
}
