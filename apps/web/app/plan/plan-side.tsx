'use client';
import { DotMap, type SpotKey } from '../../components/home-v44-dotmap';
import '../../components/home-v7.css';

// The left pane of the request window (owner canvas board v10, 28 Nov 2026): the request taking shape. A map with the
// round flags follows the chosen market, and a short summary follows every answer. It only shows what the person has
// typed in this tab; it fetches nothing and sends nothing.
const places: Record<string, SpotKey> = {
  CN: 'CN',
  AE: 'AE',
  EU: 'EU',
  GB: 'UK',
  US: 'US',
  AU: 'AU',
  SG: 'SG',
};

function shortNote(text: string) {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length > 44 ? `${line.slice(0, 44)}…` : line;
}

export function PlanSide({
  goal,
  company,
  market,
  marketCode,
  when,
  note,
}: {
  goal: string;
  company: string;
  market: string;
  marketCode: string;
  when: string;
  note: string;
}) {
  const place = places[marketCode];
  const labels: Partial<Record<SpotKey, { name?: string }>> = {};
  if (place) labels[place] = {};
  const rows: readonly (readonly [string, string])[] = [
    ['Goal', goal],
    ['Based in', company],
    ['Market', market],
    ['When', when],
    ['Note', shortNote(note)],
  ];
  return (
    <aside className="pv-side" aria-label="Your request so far">
      <p className="pv-eb">Your request</p>
      <p className="pv-side-h">Taking shape as you answer.</p>
      <div className="pv-map hv7" aria-hidden="true">
        <DotMap
          view={place && place !== 'EU' && place !== 'US' ? '330 10 380 250' : '90 0 620 250'}
          routes={place ? [place] : []}
          labels={labels}
          flags
        />
      </div>
      <dl className="pv-sum">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd data-mute={value ? undefined : ''}>{value || 'Not chosen yet'}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
