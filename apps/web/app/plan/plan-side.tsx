'use client';
import type { ReactNode } from 'react';
import { DotMap, type SpotKey } from '../../components/home-v44-dotmap';
import { Flagged, placeMark } from '../../components/ux/flag';
import type { MessageKey } from '../../lib/i18n/messages';
import { usePlanWords } from './plan-words';
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
  companyCode,
  market,
  marketCode,
  when,
  note,
  budget = '',
}: {
  goal: string;
  company: string;
  companyCode: string;
  market: string;
  marketCode: string;
  when: string;
  note: string;
  /** The amount and its original currency as typed, shown only once one is given (never converted). */
  budget?: string;
}) {
  const { t, word } = usePlanWords();
  const place = places[marketCode];
  const labels: Partial<Record<SpotKey, { name?: string }>> = {};
  if (place) labels[place] = {};
  // A place carries its flag when it is one of the nine, and shows its name only otherwise (UI/UX.v4.1 L1).
  const placed = (name: string, code: string) =>
    name ? <Flagged code={placeMark(code)}>{name}</Flagged> : '';
  const rows: readonly (readonly [MessageKey, ReactNode])[] = [
    ['home.v44.plan.side.goal', goal],
    ['home.v44.plan.side.based', placed(company, companyCode)],
    ['home.v44.plan.side.market', placed(market, marketCode)],
    ['home.v44.plan.side.when', when],
    ['home.v44.plan.side.note', shortNote(note)],
    ...(budget
      ? ([
          [
            'home.v44.plan.side.budget',
            <span key="budget" lang="en" dir="ltr">
              {budget}
            </span>,
          ],
        ] as const)
      : []),
  ];
  return (
    <aside className="pv-side" aria-label={t('home.v44.plan.side.label')}>
      <p className="pv-eb">{word('home.v44.plan.side.eyebrow')}</p>
      <p className="pv-side-h">{word('home.v44.plan.side.heading')}</p>
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
            <dt>{word(name)}</dt>
            <dd data-mute={value ? undefined : ''}>{value || word('home.v44.plan.side.empty')}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
