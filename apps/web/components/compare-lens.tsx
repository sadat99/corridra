'use client';

import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { QuoteCard } from './mr/quote-card';
import { useMrLabels } from './mr/use-labels';
import { useLanguage } from './language-provider';
import { translate } from '../lib/i18n/messages';
import type { QuoteCardView } from '../lib/quote-cards';
import { termDiff } from '../lib/term-diff';
import './compare-lens.css';

/**
 * The Compare lens: the offers as cards with the verdict first, and the original table one tap away.
 * Both views show the same approved offers and the same engine verdicts; the lens adds none. The
 * table is the component that has always been there, passed in as `matrix`.
 */
export function CompareLens({ cards, matrix }: { cards: QuoteCardView[]; matrix: ReactNode }) {
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const labels = useMrLabels();
  const { locale } = useLanguage();
  const [diffOnly, setDiffOnly] = useState(true);
  const say = (
    key:
      | 'compare.cards'
      | 'compare.table'
      | 'compare.note'
      | 'compare.diffOnly'
      | 'compare.sameHidden'
      | 'compare.sameHiddenOne'
      | 'compare.showAll'
      | 'compare.allSame'
      | 'compare.shownAll',
  ) => translate(locale, key);
  const noteId = useId();
  const diff = useMemo(() => termDiff(cards), [cards]);
  // The control exists only when there is something to fold: two or more offers with a term they all state the same.
  const canFold = diff.same.length > 0;
  const folding = canFold && diffOnly;
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Counted in the reader's own digits, so a Bengali sentence does not mix digit sets.
  const sameCount = new Intl.NumberFormat(locale).format(diff.same.length);
  const foldedText = (
    diff.same.length === 1 ? say('compare.sameHiddenOne') : say('compare.sameHidden')
  ).replace('{count}', sameCount);
  // One persistent live region: only its words change, so a screen reader hears both the fold and the unfold.
  const statusText = !folding
    ? say('compare.shownAll')
    : diff.allSame
      ? `${foldedText} ${say('compare.allSame')}`
      : foldedText;
  if (!cards.length) return <>{matrix}</>;
  return (
    <div className="compare-lens">
      <div className="compare-lens-bar">
        <div role="group" aria-label={say('compare.note')} aria-describedby={noteId}>
          {(['cards', 'table'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="compare-lens-toggle"
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {say(item === 'cards' ? 'compare.cards' : 'compare.table')}
            </button>
          ))}
        </div>
        <p id={noteId}>{say('compare.note')}</p>
      </div>
      {view === 'cards' ? (
        <>
          {canFold ? (
            <div className="compare-lens-diff">
              <button
                ref={toggleRef}
                type="button"
                className="compare-lens-diff-toggle"
                aria-pressed={diffOnly}
                onClick={() => setDiffOnly((value) => !value)}
              >
                {say('compare.diffOnly')}
              </button>
              <p role="status" className="compare-lens-diff-count">
                {statusText}
              </p>
              {folding ? (
                <button
                  type="button"
                  className="compare-lens-diff-show"
                  onClick={() => {
                    setDiffOnly(false);
                    // The button leaves with the fold: keep the keyboard place on the control that undoes it.
                    toggleRef.current?.focus();
                  }}
                >
                  {say('compare.showAll')}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="compare-lens-cards">
            {cards.map((card) => (
              <QuoteCard
                key={card.id}
                supplier={card.supplier}
                supplierLang={card.supplierLang}
                place={card.place}
                revision={card.revision}
                currency={card.currency}
                unitPrice={card.unitPrice}
                total={card.total}
                comparable={card.comparable}
                reason={card.reason}
                terms={
                  folding
                    ? card.terms.filter((term) => !diff.same.includes(term.label))
                    : card.terms
                }
                trust={card.trust}
                provenance={card.provenance}
                reference={card.reference}
                labels={labels.quote}
              />
            ))}
          </div>
        </>
      ) : (
        matrix
      )}
    </div>
  );
}
