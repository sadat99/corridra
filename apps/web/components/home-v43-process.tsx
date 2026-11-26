'use client';

import { HowTile, RulesTile } from './home-v42-parts';
import { Toggle } from './home-v43-toggle';
import { useT } from './language-provider';
import { Eyebrow } from './ux/example-tag';
import { stageIds, v43 } from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';
import { fill } from '../lib/i18n/fill';

// Home page v4.3 "How it works": the four-stage record of the chosen route (China until a door is chosen), then the
// whole process under a named disclosure so four stages are never read as all of it: the shipped fourteen steps (the
// optional ones 8 to 13 named) and the four rules. Stage buttons are reversible views and send nothing.
export function HomeV43Process({
  intent,
  stage,
  onStage,
  announce,
}: {
  intent: RouteKey;
  stage: number;
  onStage: (index: number) => void;
  announce: (text: string) => void;
}) {
  const t = useT();
  const n = stageIds[stage]!;
  return (
    <section className="hv43-band hv43-process" id="process" aria-labelledby="process-title">
      <header className="hv43-head">
        <div>
          <Eyebrow>{t(v43('process.eyebrow'))}</Eyebrow>
          <h2 id="process-title">{t(v43('process.title'))}</h2>
        </div>
        <p>{t(v43('process.lead'))}</p>
      </header>
      <div className="hv43-stages" role="group" aria-label={t(v43('process.group'))}>
        {stageIds.map((id, index) => (
          <Toggle
            key={id}
            on={stage === index}
            onPress={() => {
              onStage(index);
              announce(fill(t(v43('live.shown')), { item: t(v43(`process.step.${id}`)) }));
            }}
          >
            {t(v43(`process.step.${id}`))}
          </Toggle>
        ))}
      </div>
      <div className="hv43-record" role="group" aria-labelledby="process-record-title">
        <h3 id="process-record-title">{t(v43(`process.rec.${intent}.${n}.title`))}</h3>
        <p>{t(v43(`process.rec.${intent}.${n}.line`))}</p>
      </div>
      <details className="hv43-more">
        <summary>{t(v43('process.full'))}</summary>
        <div className="hv43-more-body">
          <HowTile />
          <RulesTile />
        </div>
      </details>
    </section>
  );
}
