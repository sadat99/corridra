'use client';

// The quote comparison table (UI/UX.v4 row "Compare", owner approval of 20 November 2026), shared by the Room
// comparison (`SourceLedger`) and the Compare lens "Side by Side" view. Pure presentation: every verdict, reason,
// value and trust label comes in from the caller's model (the comparison engine through lib/source-ledger.ts or
// lib/quote-cards.ts). It converts no currency, adds no sum or rank, and a missing term stays "Not stated",
// never zero. One real table: one column per supplier, a row label column that stays frozen while the suppliers
// scroll sideways inside their own region, so any number of suppliers can be checked on any screen.
import {
  createElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { FactLabel } from '../fact-label';
import { CorridraIcon } from '../corridra-icon';
import { fill } from '../../lib/i18n/fill';
import { localeMeta, type Locale } from '../../lib/i18n/locales';
import { translate, type MessageKey } from '../../lib/i18n/messages';
import type { FactName } from '../../lib/quote-cards';
import '../mr/quote-card.css';
import './compare-grid.css';

export type CompareGridColumn = {
  id: string;
  supplier: string;
  /** Language tag of the supplier name when it is not the page language (for example `zh`). */
  supplierLang?: string;
  place?: string;
  revision: number | string;
  currency: string;
  /** The offer's trust label. Trust is recorded per offer, so it is shown once, in the column head. */
  trust: FactName | null;
  /** Source kind and claim status exactly as the report states them; shown when there is no trust label. */
  provenance?: string;
  /** "Quoted 11 Nov 2026 · Source ref 3f9a2c1d", when the approved detail carries it. */
  reference?: string;
  /** An earlier or no longer current quote, shown only when the person asked for it. */
  historical?: boolean;
  /** The engine's verdict and, when not comparable, its reason exactly as reported. */
  comparable: boolean;
  reason?: string;
};
/** One value as written (`value`), Not stated (`value: null`), or shipping the price leaves out (`excluded`). */
export type CompareGridCell = {
  value: string | null;
  sub?: string;
  excluded?: boolean;
  /** An amount in the offer's own currency: tabular figures, never converted. */
  money?: boolean;
};
export type CompareGridRow = {
  label: string;
  cells: CompareGridCell[];
  /**
   * Every quote states this term and states it the same way, so Differences Only may fold it. The caller's model
   * decides this (lib/term-diff.ts or lib/source-ledger.ts), never this component.
   */
  same: boolean;
};

const blank = (cell: CompareGridCell) =>
  !cell.excluded && (cell.value === null || cell.value === undefined || cell.value === '');

export function CompareGrid({
  locale,
  markLang = false,
  columns,
  rows,
  note,
  headingLevel = 2,
  shippingExcluded = 0,
  foot,
  regionLabel = 'compare.region',
}: {
  locale: Locale;
  /**
   * Put `lang` and `dir` on the component's own words. The Room draws its comparison inside an English region, so
   * translated words there carry their own language; a page already in the reader's language leaves this off.
   */
  markLang?: boolean;
  columns: CompareGridColumn[];
  rows: CompareGridRow[];
  /** One row that names terms no quote states, so a short comparison is not a column of blanks. */
  note?: { label: string; text: string };
  /** The level of the "Compare quotes" heading, so it fits the outline of the page it sits in. */
  headingLevel?: 2 | 3 | 4;
  /** How many of the quotes say shipping is excluded from the price. */
  shippingExcluded?: number;
  /** Under the table and the money line: the missing terms notice, its one action, and the existing links. */
  foot?: ReactNode;
  /** The name of the scrolling region, unique on the page (the Room can show the report's table below its own). */
  regionLabel?: MessageKey;
}) {
  const say = (key: MessageKey) => translate(locale, key);
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  const words = markLang ? { lang: localeMeta[locale].html, dir: localeMeta[locale].dir } : {};
  const total = columns.length;
  const [diffOnly, setDiffOnly] = useState(true);
  const foldable = rows.filter((row) => row.same);
  const canFold = total > 1 && foldable.length > 0;
  const folding = canFold && diffOnly;
  const shown = folding ? rows.filter((row) => !row.same) : rows;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cueId = useId();
  // Where the reader is in the sideways scroll. Before the first measure the table is assumed to overflow.
  const [edge, setEdge] = useState({ atStart: true, atEnd: false, overflow: true });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => {
      // Right to left scrolls to negative values, so the distance from the start is the absolute value.
      const from = Math.abs(scroller.scrollLeft);
      const overflow = scroller.scrollWidth > scroller.clientWidth + 1;
      const next = {
        atStart: from <= 1,
        atEnd: !overflow || from + scroller.clientWidth >= scroller.scrollWidth - 1,
        overflow,
      };
      setEdge((now) =>
        now.atStart === next.atStart && now.atEnd === next.atEnd && now.overflow === next.overflow
          ? now
          : next,
      );
    };
    measure();
    scroller.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [total, shown.length]);

  const comparable = columns.filter((column) => column.comparable).length;
  const summary = fill(total === 1 ? say('compare.summaryOne') : say('compare.summary'), {
    count: number(total),
    comparable: number(comparable),
    notComparable: number(total - comparable),
  });
  const two = total === 2;
  const allSame = foldable.length === rows.length && !note;
  const statusText =
    total === 1
      ? say('compare.onlyOne')
      : !canFold
        ? ''
        : !folding
          ? say('compare.shownAll')
          : allSame
            ? fill(say(two ? 'compare.allSameBoth' : 'compare.allSameAll'), {
                total: number(total),
              })
            : fill(
                say(
                  foldable.length === 1
                    ? two
                      ? 'compare.sameBothOne'
                      : 'compare.sameAllOne'
                    : two
                      ? 'compare.sameBoth'
                      : 'compare.sameAll',
                ),
                { count: number(foldable.length), total: number(total) },
              );
  const cue =
    total > 2
      ? fill(say(edge.overflow && !edge.atEnd ? 'compare.cueScroll' : 'compare.cueSeen'), {
          total: number(total),
        })
      : null;
  const shipping =
    total > 1 && shippingExcluded > 0
      ? shippingExcluded === total
        ? fill(say(two ? 'compare.shippingBoth' : 'compare.shippingAll'), {
            total: number(total),
          })
        : fill(say('compare.shippingSome'), {
            count: number(shippingExcluded),
            total: number(total),
          })
      : null;

  return (
    <div
      className="compare-grid"
      data-at-start={edge.atStart}
      data-at-end={edge.atEnd}
      data-overflow={edge.overflow}
    >
      <div className="compare-grid-controls">
        {createElement(
          `h${headingLevel}`,
          { className: 'compare-grid-title', ...words },
          say('compare.heading'),
        )}
        <p className="compare-grid-summary" {...words}>
          {summary}
        </p>
        <div className="compare-grid-diff">
          {canFold ? (
            <button
              ref={toggleRef}
              type="button"
              className="compare-grid-toggle"
              aria-pressed={diffOnly}
              onClick={() => setDiffOnly((value) => !value)}
              {...words}
            >
              {say('compare.diffOnly')}
            </button>
          ) : null}
          {/* One persistent live region: only its words change, so a screen reader hears the fold and the unfold. */}
          <p role="status" className="compare-grid-status" {...words}>
            {statusText}
          </p>
          {folding ? (
            <button
              type="button"
              className="compare-grid-show"
              onClick={() => {
                setDiffOnly(false);
                // The button leaves with the fold: keep the keyboard place on the control that undoes it.
                toggleRef.current?.focus();
              }}
              {...words}
            >
              {say('compare.showAll')}
            </button>
          ) : null}
        </div>
      </div>

      {cue !== null ? (
        <p id={cueId} className="compare-grid-cue" {...words}>
          {cue}
        </p>
      ) : null}

      <div className="compare-grid-frame">
        <div
          ref={scrollRef}
          className="compare-grid-scroll"
          role="region"
          aria-label={say(regionLabel)}
          aria-describedby={cue !== null ? cueId : undefined}
          tabIndex={0}
        >
          <table className="compare-grid-table" style={{ '--cols': total } as CSSProperties}>
            <thead>
              <tr>
                <th scope="col" className="compare-grid-corner" {...words}>
                  {say('compare.terms')}
                </th>
                {columns.map((column) => (
                  <th scope="col" key={column.id} className="compare-grid-head">
                    <b lang={column.supplierLang} dir="auto">
                      {column.supplier}
                    </b>
                    <span
                      className="compare-grid-verdict"
                      data-ok={column.comparable ? 'true' : 'false'}
                    >
                      <span className="compare-grid-seal" aria-hidden="true">
                        {column.comparable ? '✓' : ''}
                      </span>
                      <span>
                        <span {...words}>
                          {say(column.comparable ? 'compare.comparable' : 'mr.quote.notComparable')}
                        </span>
                        {!column.comparable && column.reason ? (
                          <small lang="en">{column.reason}</small>
                        ) : null}
                      </span>
                    </span>
                    {column.place ? <small>{column.place}</small> : null}
                    <small>
                      <span {...words}>{say('mr.quote.revision')}</span>{' '}
                      <span className="compare-grid-num" dir="auto">
                        {column.revision}
                      </span>{' '}
                      · <span dir="auto">{column.currency}</span>
                    </small>
                    {column.trust ? (
                      <FactLabel label={column.trust} />
                    ) : column.provenance ? (
                      <small>{column.provenance}</small>
                    ) : null}
                    {column.reference ? <small>{column.reference}</small> : null}
                    {column.historical ? (
                      <small className="compare-grid-earlier" {...words}>
                        {say('compare.earlier')}
                      </small>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="compare-grid-label">
                    {row.label}
                  </th>
                  {row.cells.map((cell, index) => (
                    <td key={columns[index]!.id}>
                      {cell.excluded ? (
                        <span className="compare-grid-blank">
                          <span
                            className="mr-quote-fill"
                            data-fill="striped"
                            data-size="30"
                            aria-hidden="true"
                          />
                          <span>
                            <b {...words}>{say('mr.quote.excluded')}</b>
                            <small {...words}>{say('compare.excludedLine')}</small>
                          </span>
                        </span>
                      ) : blank(cell) ? (
                        <span className="compare-grid-blank">
                          <span
                            className="mr-quote-fill"
                            data-fill="hatched"
                            data-size="30"
                            aria-hidden="true"
                          />
                          <span>
                            <b {...words}>{say('mr.quote.notStated')}</b>
                            <small {...words}>{say('compare.notStatedLine')}</small>
                          </span>
                        </span>
                      ) : (
                        <>
                          <span
                            className="compare-grid-value"
                            data-money={cell.money === true}
                            dir="auto"
                          >
                            {cell.value}
                          </span>
                          {cell.sub ? <small dir="auto">{cell.sub}</small> : null}
                        </>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {note ? (
                <tr className="compare-grid-note">
                  <th scope="row" className="compare-grid-label">
                    {note.label}
                  </th>
                  <td colSpan={total}>{note.text}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="compare-grid-foot">
        <p className="compare-grid-money">
          <CorridraIcon name="shield" />
          <span {...words}>{say('compare.money')}</span>
        </p>
        {shipping !== null ? (
          <p className="compare-grid-shipping" {...words}>
            {shipping}
          </p>
        ) : null}
        {foot}
      </div>
    </div>
  );
}
