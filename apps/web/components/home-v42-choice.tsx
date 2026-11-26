'use client';

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { CorridraIcon } from './corridra-icon';
import { doorIcon, type Shown } from './home-routes';
import { TalkLink } from './home-talk';
import { useT } from './language-provider';
import { DoorCard } from './ux/door-card';
import { Flagged, type FlagCode } from './ux/flag';
import { fill } from '../lib/i18n/fill';
import type { HomeRoutesKey } from '../lib/home-routes-keys';
import type { MessageKey } from '../lib/i18n/messages';
import type { RouteKey } from '../lib/home-routes-data';

// "Which way is your business moving?" as in the owner's option 1 (owner, 25 Nov 2026: "must be always like in the
// option 1"): the four doors as one radio group, one Start a Request and the three ticks. The two big doors carry the
// route as a sentence (owner, 25 Nov 2026, framing chosen by the conductor): "Bangladesh buys from China" and
// "Bangladesh sells to EU, UK, US, Australia", a flag before every name. The line is never wrapped inside a name: it
// is one line wherever it fits, and on narrow screens the demand sentence breaks at one fixed point, the verb on the
// first row and the four places together on the second (Guardian decision B1).
const key = (name: string) => name as HomeRoutesKey;
type Place = { code: FlagCode; name: HomeRoutesKey };
const lines: Record<'china' | 'sell', { words: MessageKey; to: Place[] }> = {
  china: { words: 'home.v42.line.buys', to: [{ code: 'cn', name: key('home.country.cn') }] },
  sell: {
    words: 'home.v42.line.sells',
    to: (['eu', 'gb', 'us', 'au'] as const).map((code) => ({
      code,
      name: key(`home.tr.mk.${code}`),
    })),
  },
};

/** One whole-sentence template with {from} and {to} slots, so each language keeps its own word order. */
export function Sentence({ route }: { route: 'china' | 'sell' }) {
  const t = useT();
  const { words, to } = lines[route];
  const template = t(words);
  const at = template.indexOf('{to}');
  const slot = (text: string): ReactNode[] =>
    text
      .split(/(\{from\})/)
      .filter(Boolean)
      .map((part, i) =>
        part === '{from}' ? (
          <Flagged key={i} code="bd">
            {t('home.country.bd')}
          </Flagged>
        ) : (
          <span key={i}>{part.trim()}</span>
        ),
      );
  const places = (
    <span className="hv42-line-places">
      {to.map((p, i) => (
        <Fragment key={p.code}>
          <Flagged code={p.code}>{t(p.name)}</Flagged>
          {i < to.length - 1 ? <span className="sr-only">, </span> : null}
        </Fragment>
      ))}
      {slot(template.slice(at + 4))}
    </span>
  );
  return (
    <span className={route === 'sell' ? 'hv42-line is-two' : 'hv42-line'}>
      <span className="hv42-line-head">{slot(template.slice(0, at))}</span> {places}
    </span>
  );
}

export function HomeV42Choice({
  shown,
  opened,
  href,
  cta,
  whatsapp,
  onChoose,
}: {
  shown: Shown;
  opened: RouteKey | null;
  href: string;
  cta: string;
  whatsapp: string | null;
  onChoose: (route: RouteKey) => void;
}) {
  const t = useT();
  const door = (route: RouteKey, big: boolean) => (
    <DoorCard
      key={route}
      className={big ? 'tr-door hv42-door-wide' : 'tr-door'}
      name="home-route"
      value={route}
      checked={shown === route}
      onChoose={() => onChoose(route)}
      size={big ? 'big' : 'small'}
      tone="light"
      icon={doorIcon[route]}
      side={big ? t(route === 'china' ? 'home.tr.side.supply' : 'home.tr.side.demand') : undefined}
      route={big ? <Sentence route={route as 'china' | 'sell'} /> : undefined}
      title={t(key(`home.tr.door.${route}.title`))}
      text={t(key(`home.tr.door.${route}.text`))}
      picked={t('home.tr.selected')}
    />
  );
  return (
    <section className="tr-top hv42-choose" aria-labelledby="hv42-question">
      <fieldset className="tr-doors hv42-doors">
        <legend id="hv42-question">{t('home.tr.q')}</legend>
        <p className="tr-note">{t('home.tr.q.sub')}</p>
        <div className="hv42-doors-grid">
          <div className="hv42-doors-big">
            {(['china', 'sell'] as const).map((r) => door(r, true))}
          </div>
          <div className="hv42-doors-small">
            {(['delegation', 'other'] as const).map((r) => door(r, false))}
          </div>
        </div>
      </fieldset>
      <div className="tr-start hv42-start">
        <div className="tr-start-actions">
          <Link prefetch={false} className="primary-link" href={href} id="home-start">
            {cta}
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
    </section>
  );
}
