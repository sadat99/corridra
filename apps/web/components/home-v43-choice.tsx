'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { CorridraIcon } from './corridra-icon';
import { doorIcon } from './home-routes';
import { Sentence } from './home-v42-choice';
import { TalkLink } from './home-talk';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { DoorCard } from './ux/door-card';
import { v43 } from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';
import type { MessageKey } from '../lib/i18n/messages';

// Home page v4.3: "Which way is your business moving?" as one radio group of four doors (the v4.2 doors and one-line
// sentences, 22 px flags), one Start a Request and the three ticks, then the quiet "Build My Request". China is the
// checked door on load; choosing a door moves no focus and opens nothing: the example, steps, role, markets and request
// follow it and one polite announcement says so. The fieldset takes focus from the hero's Start a Request.
export function HomeV43Choice({
  intent,
  href,
  cta,
  whatsapp,
  onChoose,
  map,
}: {
  intent: RouteKey;
  href: string;
  cta: string;
  whatsapp: string | null;
  onChoose: (route: RouteKey) => void;
  /** Home page v4.4: the route map, beside the doors from 64 rem. Left out, the band is what it was. */
  map?: ReactNode;
}) {
  const t = useT();
  const door = (route: RouteKey, big: boolean) => (
    <DoorCard
      key={route}
      className={big ? 'tr-door hv42-door-wide' : 'tr-door'}
      name="home-route"
      value={route}
      checked={intent === route}
      onChoose={() => onChoose(route)}
      size={big ? 'big' : 'small'}
      tone="light"
      icon={doorIcon[route]}
      route={big ? <Sentence route={route as 'china' | 'sell'} /> : undefined}
      title={<PlaceWords text={t(v43(`door.${route}.title`))} />}
      text={<PlaceWords text={t(v43(`door.${route}.line`))} />}
      picked={t('home.tr.selected')}
    />
  );
  const picker = (
    <>
      <fieldset className="tr-doors hv42-doors" id="home-route-group" tabIndex={-1}>
        <legend id="hv42-question">{t('home.tr.q')}</legend>
        <p className="tr-note">{t(v43('q.sub'))}</p>
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
        <p className="hv43-build">
          <a className="button-secondary" href="#brief">
            {t(v43('brief.go'))}
          </a>
          <span className="tr-small">{t(v43('q.note'))}</span>
        </p>
      </div>
    </>
  );
  return (
    <section
      className="hv43-band hv43-choose tr-top hv42-choose"
      id="start"
      aria-labelledby="hv42-question"
    >
      <div id="pick" className="hv43-pick">
        {map ? (
          <div className="hv44-pick">
            <div className="hv44-pick-main">{picker}</div>
            <div className="hv44-pick-map">{map}</div>
          </div>
        ) : (
          picker
        )}
      </div>
    </section>
  );
}
