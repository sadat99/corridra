'use client';

import Link from 'next/link';
import { useCallback, useReducer, useState } from 'react';
import { ctaWords } from './home-routes';
import { HomeShared } from './home-shared';
import { PlainLimits } from './home-v42-parts';
import { useAnchorReveal } from './home-v43-anchors';
import { HomeV43Brief } from './home-v43-brief';
import { HomeV43Choice } from './home-v43-choice';
import { HomeV43Example } from './home-v43-example';
import { HomeV43Faq } from './home-v43-faq';
import { HomeV43Hero } from './home-v43-hero';
import { HomeV43Inbound, HomeV43Trust } from './home-v43-inbound-trust';
import { HomeV43Markets } from './home-v43-markets';
import { HomeV43People } from './home-v43-people';
import { HomeV43Process } from './home-v43-process';
import { HomeV43Reveal } from './home-v43-reveal';
import { HomeV43Solutions } from './home-v43-solutions';
import { useLanguage } from './language-provider';
import { placeText } from './place-words';
import { v43 } from '../lib/home-v43-data';
import { homeV43Reducer, initialState, sellMarket, viewIntent } from '../lib/home-v43-state';
import { routeHref, type RouteKey } from '../lib/home-routes-data';
import { fill } from '../lib/i18n/fill';
import { revealThenFocus } from '../lib/ux/anchor-focus';
import './home-v42.css';
import './home-v43.css';
import './home-v43-more.css';

// The home page v4.3, shown only while CORRIDRA_UX_HOME_V43 is exactly "true" (owner, 26 Nov 2026, via the Guardian:
// "update as per attachment 100% correctly"; docs/revamp/specs/ui-ux-v4-3.md). One light page: the hero with the
// photo, "Which way is your business moving?", the three solutions, a worked example that follows the chosen route,
// the long route block (opened only by an anchor or an action), how it works, the markets, the inbound band, trust,
// the people, the questions, the request form, Plain limits and the closing band. All interaction is one pure reducer
// (lib/home-v43-state.ts). The page sends nothing until /plan. It owns one polite announcement: a door choice or a
// press inside a widget writes one short message there, and no other region of its own is live.
export function HomeV43({ whatsapp = null }: { whatsapp?: string | null }) {
  const { t } = useLanguage();
  const [state, dispatch] = useReducer(homeV43Reducer, initialState);
  const [announcement, setAnnouncement] = useState('');
  useAnchorReveal(dispatch);
  // Cleared first and set on the next frame, so the same message said twice is spoken twice.
  const announce = useCallback((text: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);
  const intent = viewIntent(state);
  const shown = state.intent ?? 'none';
  const href = routeHref[intent];
  const cta = t(ctaWords[shown]);
  const choose = (route: RouteKey) => {
    dispatch({ type: 'door', route });
    announce(fill(t(v43('live.door')), { route: placeText(t(v43(`door.${route}.title`)), t) }));
  };
  return (
    <div className="hv42 hv43">
      <noscript>
        <p className="hv43-noscript">
          {t(v43('noscript.lead'))}{' '}
          <Link prefetch={false} href="/plan">
            {t(v43('noscript.start'))}
          </Link>{' '}
          {t(v43('noscript.or'))}{' '}
          <Link prefetch={false} href="/corridors">
            {t(v43('noscript.routes'))}
          </Link>
          .
        </p>
      </noscript>
      <p id="hv43-announce" className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <HomeV43Hero />
      <HomeV43Choice intent={intent} href={href} cta={cta} whatsapp={whatsapp} onChoose={choose} />
      <HomeV43Solutions onExplore={choose} onWalk={() => revealThenFocus('route-delegation')} />
      <HomeV43Example
        intent={intent}
        announce={announce}
        onFull={() => revealThenFocus(`route-${intent}`)}
      />
      {state.open ? (
        <HomeV43Reveal
          open={state.open}
          market={sellMarket(state)}
          whatsapp={whatsapp}
          onOpen={(route) => dispatch({ type: 'openRoute', route })}
          onClose={() => {
            dispatch({ type: 'closeRoute' });
            requestAnimationFrame(() => document.getElementById('home-start')?.focus());
          }}
          onMarket={(market) => dispatch({ type: 'market', market })}
        />
      ) : null}
      <HomeV43Process
        intent={intent}
        stage={state.stage}
        onStage={(index) => dispatch({ type: 'stage', index })}
        announce={announce}
      />
      <HomeV43Markets
        market={state.market}
        direction={state.direction}
        mine={state.intent}
        onMarket={(market) => dispatch({ type: 'market', market })}
        onDirection={(direction) => dispatch({ type: 'direction', direction })}
        onUse={() => {
          dispatch({ type: 'useRoute' });
          revealThenFocus('home-brief-job');
        }}
        announce={announce}
      />
      <HomeV43Inbound
        onInbound={() => {
          dispatch({ type: 'inbound' });
          revealThenFocus('home-brief-job');
        }}
      />
      <HomeV43Trust />
      <HomeV43People
        role={state.role}
        onRole={(role) => dispatch({ type: 'role', role })}
        announce={announce}
      />
      <HomeV43Faq />
      <PlainLimits />
      <HomeV43Brief state={state} dispatch={dispatch} whatsapp={whatsapp} />
      <HomeShared shown={shown} href={href} cta={cta} whatsapp={whatsapp} />
    </div>
  );
}
