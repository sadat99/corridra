'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { CompareGrid, type CompareGridRow } from './ux/compare-grid';
import { useLanguage } from './language-provider';
import { translate, type MessageKey } from '../lib/i18n/messages';
import type { QuoteCardView } from '../lib/quote-cards';
import { termDiff } from '../lib/term-diff';
import type { QuoteTerm } from './mr/types';
import './compare-lens.css';

/** The prices first, in the engine's own words, then every term of every quote in the order the quotes list them. */
function termsOf(card: QuoteCardView): QuoteTerm[] {
  return [
    { label: 'Original unit price', value: card.unitPrice, money: true },
    { label: 'Original total', value: card.total, money: true },
    ...card.terms,
  ];
}

/** The quotes as the shared comparison table: one column per quote, one row per term, folded by `termDiff`. */
export function sideBySide(cards: QuoteCardView[]): {
  rows: CompareGridRow[];
  shippingExcluded: number;
} {
  const offers = cards.map((card) => ({ currency: card.currency, terms: termsOf(card) }));
  const diff = termDiff(offers);
  const labels: string[] = [];
  for (const offer of offers)
    for (const term of offer.terms) if (!labels.includes(term.label)) labels.push(term.label);
  const rows = labels.map((label) => ({
    label,
    same: diff.same.includes(label),
    cells: offers.map((offer) => {
      const term = offer.terms.find((t) => t.label === label);
      // A term a quote does not list is not stated by that quote: shown as Not stated, never as zero.
      return {
        value: term?.value ?? null,
        ...(term?.state === 'excluded' ? { excluded: true } : {}),
        ...(term?.money ? { money: true } : {}),
      };
    }),
  }));
  const shippingExcluded = cards.filter((card) =>
    card.terms.some((term) => term.state === 'excluded'),
  ).length;
  return { rows, shippingExcluded };
}

/**
 * The Compare lens: the offers side by side with the verdict on top of each column, and the original table one tap
 * away. Both views show the same approved offers and the same engine verdicts; the lens adds none. The table is the
 * component that has always been there, passed in as `matrix`.
 */
export function CompareLens({
  cards,
  matrix,
  headingLevel = 4,
}: {
  cards: QuoteCardView[];
  matrix: ReactNode;
  /** The level of the comparison's heading, one below the section it sits in. */
  headingLevel?: 2 | 3 | 4;
}) {
  const [view, setView] = useState<'sideBySide' | 'table'>('sideBySide');
  const { locale } = useLanguage();
  const say = (key: MessageKey) => translate(locale, key);
  const noteId = useId();
  const grid = useMemo(() => sideBySide(cards), [cards]);
  if (!cards.length) return <>{matrix}</>;
  return (
    <div className="compare-lens">
      <div className="compare-lens-bar">
        <div role="group" aria-label={say('compare.note')} aria-describedby={noteId}>
          {(['sideBySide', 'table'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="compare-lens-toggle"
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {say(item === 'sideBySide' ? 'compare.sideBySide' : 'compare.table')}
            </button>
          ))}
        </div>
        <p id={noteId}>{say('compare.note')}</p>
      </div>
      {view === 'sideBySide' ? (
        <CompareGrid
          locale={locale}
          markLang={locale !== 'en'}
          headingLevel={headingLevel}
          columns={cards}
          rows={grid.rows}
          shippingExcluded={grid.shippingExcluded}
        />
      ) : (
        matrix
      )}
    </div>
  );
}
