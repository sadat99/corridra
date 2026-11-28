'use client';

import Link from 'next/link';
import { Inter } from 'next/font/google';
import { useEffect, useReducer, useState } from 'react';
import { ctaWords } from './home-routes';
import { useAnchorReveal } from './home-v43-anchors';
import { HomeV43Reveal } from './home-v43-reveal';
import { HomeV44Footer } from './home-v44-footer';
import { HomeV44Sheet } from './home-v44-sheet';
import {
  Choose,
  Closing,
  Example,
  Faq,
  Hero,
  Inbound,
  Process,
  Status,
  Trust,
} from './home-v7-parts';
import { useLanguage } from './language-provider';
import { Dialog } from './ux/dialog';
import { hashId, v43 } from '../lib/home-v43-data';
import { homeV43Reducer, initialState, sellMarket, viewIntent } from '../lib/home-v43-state';
import { routeHref, type RouteKey } from '../lib/home-routes-data';
import { onAnchor, revealThenFocus } from '../lib/ux/anchor-focus';
import './home-v42.css';
import './home-v43.css';
import './home-v43-more.css';
import './home-v7.css';

// The home page v7 (design approved by the owner on the canvas, 27 Nov 2026): hero on a dotted world, the route
// chooser as a segmented control with its own map, how it works, route statuses, evidence, a worked example of who does
// what, the inbound band, questions, one close and the page's own footer. One Start a Request on screen at a time; it
// opens the request as a sheet of four short steps. It keeps v4.3's one pure reducer (lib/home-v43-state.ts) and its
// anchors, sends nothing, and the long route blocks still open from their anchors, inside the v4.3 wrapper they need.
function isBriefId(id: string) {
  return id === 'brief' || id.startsWith('home-brief');
}

// Inter is the page's text face (canvas board); Newsreader for headings comes from the site's own variable.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--hv7-font',
  display: 'swap',
});

export function HomeV7({ whatsapp = null }: { whatsapp?: string | null }) {
  const { t } = useLanguage();
  const [state, dispatch] = useReducer(homeV43Reducer, initialState);
  useAnchorReveal(dispatch);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const stop = onAnchor((id) => {
      if (isBriefId(id)) setSheet(true);
    });
    const fromHash = () => {
      if (isBriefId(hashId(window.location.hash))) setSheet(true);
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();
    return () => {
      stop();
      window.removeEventListener('hashchange', fromHash);
    };
  }, []);
  const closeSheet = () => {
    setSheet(false);
    if (isBriefId(hashId(window.location.hash)))
      history.replaceState(null, '', window.location.pathname + window.location.search);
  };
  const intent = viewIntent(state);
  const shown = state.intent ?? 'none';
  const href = routeHref[intent];
  const cta = t(ctaWords[shown]);
  const choose = (route: RouteKey) => dispatch({ type: 'door', route });
  return (
    <div className={`hv7 ${inter.variable}`}>
      <noscript>
        <p className="hv7-noscript">
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
      <Hero />
      <Choose intent={intent} onChoose={choose} />
      <Process />
      <Status />
      <Trust />
      <Example />
      {state.open ? (
        <div className="hv42 hv43">
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
        </div>
      ) : null}
      <Inbound
        onInbound={() => {
          dispatch({ type: 'inbound' });
          revealThenFocus('home-brief-job');
        }}
      />
      <Faq />
      <Dialog open={sheet} onClose={closeSheet} title={t(v43('brief.eyebrow'))} keepMounted>
        <div className="hv7-sheet">
          <HomeV44Sheet
            state={state}
            dispatch={dispatch}
            whatsapp={whatsapp}
            onCancel={closeSheet}
          />
        </div>
      </Dialog>
      <Closing shown={shown} href={href} cta={cta} />
      <HomeV44Footer />
    </div>
  );
}
