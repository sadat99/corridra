'use client';

import { BuyerConsole, QuoteConsole, SequenceConsole } from './home-v43-consoles';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import { ExampleTag, Eyebrow } from './ux/example-tag';
import { Flagged } from './ux/flag';
import { intents, placeFlag, placeName, v43 } from '../lib/home-v43-data';
import type { RouteKey } from '../lib/home-routes-data';

// Home page v4.3 worked example: the title, the route line and the console follow the chosen route (China until a door
// is chosen). The console starts again from its first state whenever the route changes. It is sample data, tagged so,
// and sends nothing. "See the Full Example" opens the long route block of the same route.
export function HomeV43Example({
  intent,
  announce,
  onFull,
}: {
  intent: RouteKey;
  announce: (text: string) => void;
  onFull: () => void;
}) {
  const t = useT();
  const [from, to] = intents[intent].line;
  const place = (code: typeof from) => (
    <Flagged code={placeFlag[code]}>{t(placeName[code])}</Flagged>
  );
  return (
    <section className="hv43-band hv43-example" id="example" aria-labelledby="example-title">
      <div className="hv43-example-grid">
        <div className="hv43-lede">
          <Eyebrow>{t(v43('ex.eyebrow'))}</Eyebrow>
          <p className="hv43-routeline">
            {place(from)} <span>{t('home.b3.to')}</span> {place(to)}
          </p>
          <h2 id="example-title" tabIndex={-1}>
            {t(v43(`ex.${intent}.title`))}
          </h2>
          <p>
            <PlaceWords text={t(v43(`ex.${intent}.desc`))} />
          </p>
          <div className="hv43-lede-actions">
            <a className="text-link" href="#brief">
              {t(v43('ex.cta'))}
            </a>
            <button type="button" className="text-link" onClick={onFull}>
              {t(v43('ex.full'))}
            </button>
          </div>
        </div>
        <div className="hv43-console" role="group" aria-label={t(v43('ex.region'))}>
          <div className="hv43-console-head">
            <span>{t(v43(`ex.${intent}.console`))}</span>
            <ExampleTag>{t(v43('ex.sample'))}</ExampleTag>
          </div>
          <div className="hv43-console-body" key={intent}>
            {intent === 'china' ? <QuoteConsole announce={announce} /> : null}
            {intent === 'sell' ? <BuyerConsole announce={announce} /> : null}
            {intent === 'delegation' ? <SequenceConsole kind="dl" announce={announce} /> : null}
            {intent === 'other' ? <SequenceConsole kind="other" announce={announce} /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
