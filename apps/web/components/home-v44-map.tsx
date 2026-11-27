'use client';

import { useEffect, useState, type Dispatch } from 'react';
import { useT } from './language-provider';
import { Flagged } from './ux/flag';
import { ZoomRouteMap } from './world-route-map';
import type { world as WorldData } from './world-geography';
import { placeFlag, placeName, targetOptions, v43, type PlaceCode } from '../lib/home-v43-data';
import type { HomeV43Event } from '../lib/home-v43-state';

// Home page v4.4 route map (owner, 27 Nov 2026, decision 4): the route of the request, drawn from its own base and
// target (the same two values the request form holds), framed on the route. In the route choice it also lists the
// target markets as pressed-or-not buttons, which set the form's target; in the request form it is the picture only,
// because the form has its own list. The world outlines are a lazy chunk, so the home ships them only when this runs.
// Decorative: the route is written in words under it. Nothing moves except the arc drawing once on a change.
type World = typeof WorldData;

export function HomeV44Map({
  origin,
  target,
  pick,
  dispatch,
}: {
  origin: PlaceCode;
  target: PlaceCode;
  pick: boolean;
  dispatch: Dispatch<HomeV43Event>;
}) {
  const t = useT();
  const [world, setWorld] = useState<World | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let live = true;
    void import('./world-geography').then((m) => {
      if (live) setWorld(m.world);
    });
    return () => {
      live = false;
    };
  }, []);
  const name = (code: PlaceCode) => t(placeName[code]);
  const markets = targetOptions(origin);
  return (
    <figure className={paused || !pick ? 'hv44-route hv44-paused' : 'hv44-route'}>
      <div className="hv44-frame">
        {world ? (
          <ZoomRouteMap
            world={world}
            from={origin}
            to={target}
            names={{ from: name(origin), to: name(target) }}
          />
        ) : null}

        {pick ? (
          <button
            type="button"
            className="hv44-pause"
            aria-pressed={paused}
            onClick={() => setPaused(!paused)}
          >
            {t(paused ? 'home.v44.motion.play' : 'home.v44.motion.pause')}
          </button>
        ) : null}
      </div>
      <figcaption className="sr-only">
        <span className="label">{t(v43('brief.card'))}</span>
        <span className="hv44-route-words">
          <Flagged code={placeFlag[origin]}>{name(origin)}</Flagged>
          <span aria-hidden="true">{' → '}</span>
          <Flagged code={placeFlag[target]}>{name(target)}</Flagged>
        </span>
      </figcaption>
      {pick ? (
        <div className="hv44-markets" role="group" aria-label={t(v43('brief.f.to'))}>
          {markets.map((code) => (
            <button
              key={code}
              type="button"
              className="hv44-chip"
              aria-pressed={target === code}
              onClick={() => dispatch({ type: 'brief', field: 'target', value: code })}
            >
              <Flagged code={placeFlag[code]}>{name(code)}</Flagged>
            </button>
          ))}
        </div>
      ) : null}
    </figure>
  );
}
