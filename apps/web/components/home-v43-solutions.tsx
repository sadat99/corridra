'use client';

import { CorridraIcon, type IconName } from './corridra-icon';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { Eyebrow } from './ux/example-tag';
import { solutionIcons, v43 } from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';
import { revealThenFocus } from '../lib/ux/anchor-focus';

// Home page v4.3 "Solutions": three focused assignments, each with what the visitor can get. "Explore ... Example"
// chooses that route and moves to the worked example; "Walk Through a Sample Programme" opens the delegation route
// (the existing programme table) and takes focus there. Neither is a new page, and nothing is sent.
type Card = { id: 'source' | 'sell' | 'delegation'; route: RouteKey; icon: IconName };
const cards: readonly Card[] = [
  { id: 'source', route: 'china', icon: solutionIcons.source },
  { id: 'sell', route: 'sell', icon: solutionIcons.sell },
  { id: 'delegation', route: 'delegation', icon: solutionIcons.delegation },
];

export function HomeV43Solutions({
  onExplore,
  onWalk,
}: {
  onExplore: (route: RouteKey) => void;
  onWalk: () => void;
}) {
  const t = useT();
  return (
    <section className="hv43-band hv43-solutions" id="solutions" aria-labelledby="solutions-title">
      <header className="hv43-head">
        <div>
          <Eyebrow>{t(v43('sol.eyebrow'))}</Eyebrow>
          <h2 id="solutions-title">{t(v43('sol.title'))}</h2>
        </div>
        <p>{t(v43('sol.lead'))}</p>
      </header>
      <div className="hv43-cards">
        {cards.map((card) => (
          <article
            className="hv43-card"
            id={`service-${card.id}`}
            key={card.id}
            aria-labelledby={`service-${card.id}-title`}
          >
            <div className="hv43-card-head">
              <span className="hv43-icon" aria-hidden="true">
                <CorridraIcon name={card.icon} size={20} />
              </span>
              <h3 id={`service-${card.id}-title`}>
                <PlaceWords text={t(v43(`door.${card.route}.title`))} />
              </h3>
            </div>
            <p>
              <PlaceWords text={t(v43(`sol.${card.id}.text`))} />
            </p>
            <div className="hv43-get">
              <strong>{t(v43('sol.get'))}</strong>
              <span>{t(v43(`sol.${card.id}.get`))}</span>
            </div>
            <div className="hv43-card-actions">
              <a
                className="text-link"
                href="#example"
                onClick={(event) => {
                  event.preventDefault();
                  onExplore(card.route);
                  revealThenFocus('example-title');
                }}
              >
                {t(v43(`sol.${card.id}.go`))}
              </a>
              {card.id === 'delegation' ? (
                <button type="button" className="text-link" onClick={onWalk}>
                  {t(v43('sol.delegation.walk'))}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
