'use client';

import { useT } from './language-provider';
import { Flagged } from './ux/flag';
import { placeFlag, placeName, v43, type PlaceCode } from '../lib/home-v43-data';

// The route of a request as the visitor set it: "<from> to <to>" with a mark before each name, except when a side is
// Key Asian Markets or undecided, where it is two labelled chips (never a sentence "Bangladesh to Key Asian Markets").
export function RouteSummary({ origin, target }: { origin: PlaceCode; target: PlaceCode }) {
  const t = useT();
  const chip = (code: PlaceCode) => <Flagged code={placeFlag[code]}>{t(placeName[code])}</Flagged>;
  const loose = [origin, target].some((code) => code === 'REGION' || code === 'OTHER');
  return loose ? (
    <span className="hv43-chips">
      <span className="hv43-endpoint">
        <span className="label">{t(v43('brief.f.from'))}</span>
        {chip(origin)}
      </span>
      <span className="hv43-endpoint">
        <span className="label">{t(v43('brief.f.to'))}</span>
        {chip(target)}
      </span>
    </span>
  ) : (
    <span className="hv43-chips">
      {chip(origin)} <span>{t('home.b3.to')}</span> {chip(target)}
    </span>
  );
}
