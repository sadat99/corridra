'use client';

import { useId, useState } from 'react';
import { Toggle } from './home-v43-toggle';
import { useT } from './language-provider';
import { PlaceWords } from './place-words';
import {
  buyerRows,
  deliveryCodes,
  fairRowCount,
  offerAmounts,
  offerIds,
  phaseIds,
  questionIds,
  v43,
} from '../lib/home-v43-data';
import { fill, fillNodes } from '../lib/i18n/fill';

// Home page v4.3: the interactive part of the worked example, one console for each route. Every control is a button
// with `aria-pressed` inside a named group, reversible and local: nothing is sent or stored. The result regions have
// no live region of their own; the page has one announcer and a press posts a short message to it. Amounts are the
// sample figures, USD as written, never converted, summed or ranked.
type Announce = (text: string) => void;

function Result({
  title,
  line,
  labelledBy,
}: {
  title: string;
  line: React.ReactNode;
  labelledBy: string;
}) {
  return (
    <div className="hv43-result" role="group" aria-labelledby={labelledBy}>
      <strong id={labelledBy}>{title}</strong>
      <p>{line}</p>
    </div>
  );
}

/** Three offers for the same machine: pick one to see what its figure includes and what is still open. */
export function QuoteConsole({ announce }: { announce: Announce }) {
  const t = useT();
  const ids = useId();
  const [picked, setPicked] = useState<(typeof offerIds)[number] | null>(null);
  const name = (id: (typeof offerIds)[number]) => t(v43(`ex.china.offer.${id}.name`));
  const terms = (id: (typeof offerIds)[number]) =>
    fill(t(v43(`ex.china.offer.${id}.terms`)), {
      code: deliveryCodes[id as keyof typeof deliveryCodes] ?? '',
    });
  return (
    <>
      <ul className="hv43-offers">
        {offerIds.map((id) => (
          <li key={id}>
            <Toggle
              on={picked === id}
              describedBy={`${ids}-terms-${id}`}
              onPress={() => {
                setPicked(id);
                announce(fill(t(v43('live.chosen')), { item: name(id) }));
              }}
            >
              {name(id)} <span dir="ltr">{offerAmounts[id]}</span>
            </Toggle>
            <span id={`${ids}-terms-${id}`} className="hv43-terms">
              {terms(id)}
            </span>
          </li>
        ))}
      </ul>
      <Result
        labelledBy={`${ids}-result`}
        title={
          picked
            ? fill(t(v43('ex.china.result')), { name: name(picked) })
            : t(v43('ex.china.start.title'))
        }
        line={picked ? t(v43(`ex.china.offer.${picked}.detail`)) : t(v43('ex.china.start.line'))}
      />
      <p className="hv43-next">
        <strong>{t(v43('ex.next'))}</strong> {t(v43('ex.china.next'))}
      </p>
      <noscript>
        <p>{fillNodes(t(v43('ex.fallback.a')), { amount: <b>{offerAmounts.b}</b> })}</p>
        <p>{fillNodes(t(v43('ex.fallback.b')), { amount: <b>{offerAmounts.c}</b> })}</p>
      </noscript>
    </>
  );
}

/** The fair list against the shortlist built around what the company can supply. Reversible. */
export function BuyerConsole({ announce }: { announce: Announce }) {
  const t = useT();
  const ids = useId();
  const [view, setView] = useState<'fair' | 'short'>('fair');
  const rows =
    view === 'fair' ? buyerRows.slice(0, fairRowCount) : buyerRows.filter((row) => row.shortlist);
  const choose = (next: 'fair' | 'short') => {
    setView(next);
    announce(fill(t(v43('live.shown')), { item: t(v43(`ex.sell.view.${next}`)) }));
  };
  return (
    <>
      <div className="hv43-segments" role="group" aria-label={t(v43('ex.sell.group'))}>
        <Toggle on={view === 'fair'} onPress={() => choose('fair')}>
          {t(v43('ex.sell.view.fair'))}
        </Toggle>
        <Toggle on={view === 'short'} onPress={() => choose('short')}>
          {t(v43('ex.sell.view.short'))}
        </Toggle>
      </div>
      <ul className="hv43-buyers">
        {rows.map((row) => (
          <li key={row.id}>
            <strong>{t(v43(`ex.sell.row.${row.id}.name`))}</strong>
            <span className="hv43-status">{t(v43(`ex.sell.row.${row.id}.status`))}</span>
            <span>{t(v43(`ex.sell.row.${row.id}.line`))}</span>
          </li>
        ))}
      </ul>
      <Result
        labelledBy={`${ids}-result`}
        title={t(v43(`ex.sell.res.${view}.title`))}
        line={t(v43(`ex.sell.res.${view}.line`))}
      />
    </>
  );
}

/** Three phases of a delegation, or three questions that shape a first request: one is shown at a time. */
export function SequenceConsole({ kind, announce }: { kind: 'dl' | 'other'; announce: Announce }) {
  const t = useT();
  const ids = useId();
  const [index, setIndex] = useState(0);
  const items = kind === 'dl' ? phaseIds : questionIds;
  const part = kind === 'dl' ? 'phase' : 'q';
  const at = (n: number, field: 'label' | 'title' | 'line') =>
    t(v43(`ex.${kind}.${part}.${n}.${field}`));
  const current = items[index]!;
  return (
    <>
      <div className="hv43-segments" role="group" aria-label={t(v43(`ex.${kind}.group`))}>
        {items.map((n, i) => (
          <Toggle
            key={n}
            on={index === i}
            onPress={() => {
              setIndex(i);
              announce(fill(t(v43('live.shown')), { item: at(n, 'label') }));
            }}
          >
            {at(n, 'label')}
          </Toggle>
        ))}
      </div>
      <Result
        labelledBy={`${ids}-result`}
        title={at(current, 'title')}
        line={<PlaceWords text={at(current, 'line')} />}
      />
    </>
  );
}
