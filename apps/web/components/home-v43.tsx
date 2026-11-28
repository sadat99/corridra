'use client';

import Link from 'next/link';
import { useCallback, useEffect, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import { ctaWords, type Shown } from './home-routes';
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
import { hashId, v43 } from '../lib/home-v43-data';
import {
  homeV43Reducer,
  initialState,
  sellMarket,
  viewIntent,
  type HomeV43Event,
  type HomeV43State,
} from '../lib/home-v43-state';
import { routeHref, type RouteKey } from '../lib/home-routes-data';
import { fill } from '../lib/i18n/fill';
import { onAnchor, revealThenFocus } from '../lib/ux/anchor-focus';
import { Dialog } from './ux/dialog';
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
/**
 * Home page v4.4 (owner, 27 Nov 2026, decision 4): what the redesign swaps in while CORRIDRA_UX_HOME_V44 is on. The
 * hero replaces the v4.3 hero; `map` draws the route of the request (its own base and target) and is placed beside the
 * route choice and at the top of the request summary. Left out, the page is the v4.3 page.
 */
export type HomeV44Slots = {
  hero: ReactNode;
  /** The route choice as tabs (same ids and words as the v4.3 doors). */
  choice: (props: {
    intent: RouteKey;
    href: string;
    cta: string;
    whatsapp: string | null;
    onChoose: (route: RouteKey) => void;
  }) => ReactNode;
  /** The page's own footer (the shared one is hidden on this page). */
  footer: ReactNode;
  /** The route statuses as a list, after the evidence. */
  status: ReactNode;
  /** The close of the page, light, with the three jobs as cards. */
  closing: (props: {
    shown: Shown;
    href: string;
    cta: string;
    whatsapp: string | null;
  }) => ReactNode;
  /** The worked example, as four steps of who does what (replaces the v4.3 console). */
  example: (props: { onFull: () => void }) => ReactNode;
  /** The request, in four short steps (replaces the v4.3 form inside the sheet). */
  sheet: (props: {
    state: HomeV43State;
    dispatch: Dispatch<HomeV43Event>;
    whatsapp: string | null;
    onCancel: () => void;
  }) => ReactNode;
};

function isBriefHash() {
  const id = hashId(window.location.hash);
  return id === 'brief' || id.startsWith('home-brief');
}

export function HomeV43({
  whatsapp = null,
  summaries,
  v44,
}: {
  whatsapp?: string | null;
  /**
   * CORRIDRA_UX_HOW_TRUST_V43 (owner, 26 Nov 2026, first hand to Guardian G66): the process and trust bands become the
   * given summaries (three short lines each, linking to /how-it-works and /trust); the role picker, the long answers
   * and Plain Limits leave the home, because those pages carry them. The bands arrive as slots from
   * home-v43-summarised.tsx, so this module names neither them nor their stylesheet. Off, the page is what it was.
   */
  summaries?: { process: ReactNode; trust: ReactNode };
  /** CORRIDRA_UX_HOME_V44: the redesign's hero and route map (see `HomeV44Slots`). */
  v44?: HomeV44Slots;
}) {
  const { t } = useLanguage();
  const [state, dispatch] = useReducer(homeV43Reducer, initialState);
  const [announcement, setAnnouncement] = useState('');
  useAnchorReveal(dispatch);
  // Home page v4.4: the request form is a sheet. Any link to it (the #brief hash, the request form's own ids, an action
  // on the page) opens the sheet; closing it clears the hash so the same link works again.
  const [sheet, setSheet] = useState(false);
  const sheetOn = v44 !== undefined;
  useEffect(() => {
    if (!sheetOn) return;
    const isBrief = (id: string) => id === 'brief' || id.startsWith('home-brief');
    const stop = onAnchor((id) => {
      if (isBrief(id)) setSheet(true);
    });
    const fromHash = () => {
      if (isBrief(hashId(window.location.hash))) setSheet(true);
    };
    window.addEventListener('hashchange', fromHash);
    fromHash();
    return () => {
      stop();
      window.removeEventListener('hashchange', fromHash);
    };
  }, [sheetOn]);
  const closeSheet = () => {
    setSheet(false);
    if (isBriefHash())
      history.replaceState(null, '', window.location.pathname + window.location.search);
  };
  // Cleared first and set on the next frame, so the same message said twice is spoken twice.
  const announce = useCallback((text: string) => {
    setAnnouncement('');
    requestAnimationFrame(() => setAnnouncement(text));
  }, []);
  const wide = v44 && summaries ? { v44, summaries } : null;
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
      {v44 ? v44.hero : <HomeV43Hero />}
      {v44 ? (
        <>
          {v44.choice({ intent, href, cta, whatsapp, onChoose: choose })}
        </>
      ) : (
        <HomeV43Choice
          intent={intent}
          href={href}
          cta={cta}
          whatsapp={whatsapp}
          onChoose={choose}
        />
      )}
      {wide ? null : (
        <HomeV43Solutions onExplore={choose} onWalk={() => revealThenFocus('route-delegation')} />
      )}
      {wide ? (
        <>
          {wide.summaries.process}
          {wide.v44.status}
          {wide.summaries.trust}
          {wide.v44.example({ onFull: () => revealThenFocus(`route-${intent}`) })}
        </>
      ) : (
        <HomeV43Example
          intent={intent}
          announce={announce}
          onFull={() => revealThenFocus(`route-${intent}`)}
        />
      )}
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
      {wide ? null : summaries ? (
        summaries.process
      ) : (
        <HomeV43Process
          intent={intent}
          stage={state.stage}
          onStage={(index) => dispatch({ type: 'stage', index })}
          announce={announce}
        />
      )}
      {wide ? null : (
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
      )}
      <HomeV43Inbound
        onInbound={() => {
          dispatch({ type: 'inbound' });
          revealThenFocus('home-brief-job');
        }}
      />
      {summaries ? (
        <>
          {wide ? null : summaries.trust}
          <HomeV43Faq more={false} />
        </>
      ) : (
        <>
          <HomeV43Trust />
          <HomeV43People
            role={state.role}
            onRole={(role) => dispatch({ type: 'role', role })}
            announce={announce}
          />
          <HomeV43Faq />
          <PlainLimits />
        </>
      )}
      {v44 ? (
        <Dialog open={sheet} onClose={closeSheet} title={t(v43('brief.eyebrow'))} keepMounted>
          <div className="hv44-sheet">
            {v44.sheet({ state, dispatch, whatsapp, onCancel: closeSheet })}
          </div>
        </Dialog>
      ) : (
        <HomeV43Brief state={state} dispatch={dispatch} whatsapp={whatsapp} />
      )}
      {v44 ? (
        v44.closing({ shown, href, cta, whatsapp })
      ) : (
        <HomeShared shown={shown} href={href} cta={cta} whatsapp={whatsapp} />
      )}
      {v44 ? v44.footer : null}
    </div>
  );
}
