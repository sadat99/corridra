'use client';

import Link from 'next/link';
import { useState } from 'react';
import './corridor-dossier.css';
import { CorridraIcon } from './corridra-icon';
import { FactLabel } from './fact-label';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { ExampleTag } from './ux/example-tag';
import { Flagged } from './ux/flag';
import {
  explorerMarkets,
  intents,
  marketPlace,
  placeFlag,
  placeName,
  routeForMarket,
  routeRecord,
  type Direction,
  type ExplorerMarket,
} from '../lib/home-v43-data';
import { briefHref } from '../lib/home-routes-data';

// The sample counterparty dossier of the sample mission at /corridors#mission-example, drawn only while
// CORRIDRA_UX_HOME_V43 is on (the page passes it as a slot; owner, 26 Nov 2026, via the Guardian: "update as per
// attachment 100% correctly"). One invented counterparty, one route, a potential fit, what is claimed and what is
// backed, and a next action. The choices and the shortlist are views on this page only: nothing is stored, sent or
// read, and a reload starts over. The words are English like the rest of this page, and none is a result.
const counterparty = 'Example Precision Works';
const copy = {
  out: {
    fit: 'Makes the kind of product a buyer on this route asks about and says it ships to the other end of the route. A potential fit, not a check.',
    next: 'Ask for the missing specification and the original quote terms, then decide whether to meet. Nothing is sent from this page.',
  },
  in: {
    fit: 'Looks for a local partner and says it has sold here before. Taken case by case, a potential fit, not a check.',
    next: 'Ask what the company needs locally and what it can show. Nothing is sent from this page.',
  },
} as const;

export function CorridorDossier() {
  const t = useT();
  const [direction, setDirection] = useState<Direction>('out');
  const [market, setMarket] = useState<ExplorerMarket>('cn');
  const [saved, setSaved] = useState(false);
  const route = routeRecord(market, direction);
  const goal = intents[routeForMarket(market, direction)].goal;
  const href = briefHref(goal, '', { from: route.origin, to: route.destination });
  const words = copy[direction];
  return (
    <section className="ux-dossier" aria-labelledby="dossier-title">
      <div className="ux-dossier-head">
        <h3 id="dossier-title">Sample Counterparty Dossier</h3>
        <ExampleTag>Sample data</ExampleTag>
      </div>
      <p className="ux-dossier-lead">
        An invented company, shown so you can see what a dossier holds. Nothing here is saved or
        sent.
      </p>
      <div className="ux-dossier-choices">
        <div role="group" aria-label="Direction">
          {(['out', 'in'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="ux-dossier-choice"
              aria-pressed={direction === value}
              onClick={() => setDirection(value)}
            >
              {direction === value ? <CorridraIcon name="check" size={16} /> : null}
              <PlaceWords text={value === 'out' ? 'From {bd}' : 'Into {bd}'} />
            </button>
          ))}
        </div>
        <div role="group" aria-label="Market">
          {explorerMarkets.map((value) => (
            <button
              key={value}
              type="button"
              className="ux-dossier-choice"
              aria-pressed={market === value}
              onClick={() => setMarket(value)}
            >
              {market === value ? <CorridraIcon name="check" size={16} /> : null}
              <Flagged code={placeFlag[marketPlace[value]]}>
                {t(placeName[marketPlace[value]])}
              </Flagged>
            </button>
          ))}
        </div>
      </div>
      <p className="ux-dossier-route">
        <Flagged code={placeFlag[route.origin]}>{t(placeName[route.origin])}</Flagged>
        <span aria-hidden="true"> / </span>
        <Flagged code={placeFlag[route.destination]}>{t(placeName[route.destination])}</Flagged>
        <span className="ux-dossier-status"> {t(route.status)}</span>
      </p>
      <h4 className="ux-dossier-name">{counterparty}</h4>
      <dl className="ux-dossier-rows">
        <div>
          <dt>Potential Fit</dt>
          <dd>{words.fit}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            <p>
              <FactLabel label="Self-declared" english />{' '}
              <span className="ux-dossier-words">
                <PlaceWords text="Says it ships to {bd}" />
              </span>
              <span className="ux-dossier-words">Their own words, not checked.</span>
            </p>
            <p>
              <FactLabel label="Evidence available" english />{' '}
              <span className="ux-dossier-words">
                An export licence copy can be shared. Corridra has not checked it.
              </span>
            </p>
          </dd>
        </div>
        <div>
          <dt>Next Action</dt>
          <dd>{words.next}</dd>
        </div>
      </dl>
      <div className="ux-dossier-actions">
        <button type="button" className="button-secondary" onClick={() => setSaved(!saved)}>
          {saved ? 'Remove from Shortlist' : 'Save to Shortlist'}
        </button>
        <Link prefetch={false} className="text-link" href={href}>
          Start a Request for This Route
        </Link>
        <Link prefetch={false} className="text-link" href="/#markets">
          Back to the Markets Section
        </Link>
      </div>
      {saved ? (
        <p className="ux-dossier-saved" role="status">
          Kept on this page only. Reload the page and it is gone.
        </p>
      ) : null}
    </section>
  );
}
