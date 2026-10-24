import './quote-card.css';
import './scripts.css';
import { FactLabel } from '../fact-label';
import { mrLabels } from './labels';

import type { QuoteTerm } from './types';
export type { QuoteTerm } from './types';

/**
 * One supplier offer, drawn as a card. Pure presentation: it takes the result of the existing
 * comparison engine and adds no verdict of its own. A filled seal and the words "Comparable on
 * supplied terms" only when the engine says so; otherwise an open ring and "Not comparable yet"
 * with the reason exactly as the engine reports it. A missing term says "Not stated", never zero.
 * Original currency, tabular figures, and the price carries its trust label through `FactLabel`.
 */
export function QuoteCard({
  supplier,
  supplierLang,
  place,
  revision,
  currency,
  unitPrice,
  total,
  comparable,
  reason,
  terms,
  trust = 'Self-declared',
  provenance,
  labels = mrLabels.quote,
}: {
  supplier: string;
  /** Language tag of the supplier name when it is not the page language (for example `zh`). */
  supplierLang?: string;
  place?: string;
  revision: string | number;
  currency: string;
  /** Already formatted in the original currency with its code. */
  unitPrice?: string | null;
  total?: string | null;
  comparable: boolean;
  /** The engine's reason when not comparable (missing terms, an expired quote, a total mismatch). */
  reason?: string;
  terms: QuoteTerm[];
  /** The fact label for the price. `null` when the source status is not one of the five names: nothing is guessed. */
  trust?: Parameters<typeof FactLabel>[0]['label'] | null;
  /** The source and claim status exactly as the approved report states them; shown when there is no fact label. */
  provenance?: string;
  labels?: typeof mrLabels.quote;
}) {
  return (
    <article className="mr-quote" data-comparable={comparable}>
      <header>
        <h3 lang={supplierLang}>{supplier}</h3>
        <p className="mr-quote-sub">
          {place ? `${place} · ` : ''}
          {labels.revision} <span className="mr-num">{revision}</span> · {currency}
        </p>
      </header>
      <p className="mr-quote-verdict">
        <span className="mr-quote-seal" aria-hidden="true">
          {comparable ? '✓' : ''}
        </span>
        <span>
          {comparable ? labels.comparable : labels.notComparable}
          {!comparable && reason ? <small>{reason}</small> : null}
        </span>
      </p>
      <div className="mr-quote-price">
        <span>{labels.unitPrice}</span>
        <strong className="mr-num">{unitPrice ?? labels.notStated}</strong>
        <span>
          {labels.total}: <span className="mr-num">{total ?? labels.notStated}</span>
        </span>
        {trust ? <FactLabel label={trust} /> : provenance ? <small>{provenance}</small> : null}
      </div>
      <dl className="mr-quote-terms">
        {terms.map((term) => {
          const missing = term.value === null || term.value === undefined || term.value === '';
          return (
            <div key={term.label} data-missing={missing}>
              <dt>{term.label}</dt>
              <dd>{missing ? labels.notStated : term.value}</dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}
