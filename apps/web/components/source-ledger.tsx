'use client';

// The Source room's quote comparison (approved work rooms, 5 Nov 2026). One column per supplier on a wide
// screen, one card per supplier on a phone; the key machinery terms first and every other term one tap away.
// The model is lib/source-ledger.ts: it adds no verdict, converts no currency and keeps a missing term missing.
import type { MissionExperience } from '@corridra/delivery/report';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { sourceLedger, type LedgerCell } from '../lib/source-ledger';
import { FactLabel } from './fact-label';
import { CorridraIcon } from './corridra-icon';
import './source-ledger.css';

function Cell({ cell }: { cell: LedgerCell }) {
  if (cell.value === null || cell.value === undefined)
    return <span className="ledger-missing">Not stated</span>;
  return (
    <>
      <span dir="auto">{cell.value}</span>
      {cell.sub ? <small>{cell.sub}</small> : null}
    </>
  );
}

export function SourceLedger({
  experience,
  language = 'en',
  more,
}: {
  experience: MissionExperience;
  language?: string;
  /** One more action for the foot of the comparison (the Room's "Show the requirement..." control). */
  more?: ReactNode;
}) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [allTerms, setAllTerms] = useState(false);
  const [includeEarlier, setIncludeEarlier] = useState(false);
  const toggleId = useId();
  const ledger = useMemo(
    () => sourceLedger(experience, { includeEarlier, language }),
    [experience, includeEarlier, language],
  );
  if (ledger.columns.length === 0)
    return (
      <section className="ledger" aria-label="Compare quotes">
        <p className="ledger-empty" role="status">
          No quotes on the current request yet.
          {ledger.earlier > 0
            ? ` ${ledger.earlier} earlier ${ledger.earlier === 1 ? 'quote is' : 'quotes are'} kept.`
            : ''}
        </p>
        {/* The requirement and the shortlist stay one tap away before the first quote arrives (Codex, PR 314). */}
        <div className="ledger-foot">
          <span className="ledger-foot-actions">
            {ledger.earlier > 0 ? (
              <button type="button" className="text-link" onClick={() => setIncludeEarlier(true)}>
                Show Earlier Quotes
              </button>
            ) : null}
            {more}
          </span>
        </div>
      </section>
    );
  const keyRows = ledger.rows.filter((row) => row.key);
  const shown = ledger.rows.filter(
    (row) => (allTerms || row.key) && (!differencesOnly || row.differs),
  );
  const hiddenTerms = ledger.rows.length - keyRows.length;
  const count = ledger.columns.length;
  return (
    <section className="ledger" aria-label="Compare quotes">
      <div className="ledger-scroll" role="region" aria-label="Quotes side by side" tabIndex={0}>
        <table className="ledger-table">
          <thead>
            <tr>
              <td className="ledger-corner">
                <CorridraIcon name="shield" />
                Prices as each supplier quoted, never converted.
              </td>
              {ledger.columns.map((column) => (
                <th scope="col" key={column.id}>
                  <b lang={column.supplierLang}>{column.supplier}</b>
                  {column.place ? <small>{column.place}</small> : null}
                  {column.trust ? <FactLabel label={column.trust} /> : null}
                  {column.historical ? (
                    <small className="ledger-earlier">Earlier quote</small>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {row.cells.map((cell, index) => (
                  <td key={ledger.columns[index]!.id}>
                    <Cell cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="ledger-verdict">
              <th scope="row">Can be compared</th>
              {ledger.columns.map((column) => (
                <td key={column.id}>
                  <span className="ledger-badge" data-ok={column.comparable ? 'true' : 'false'}>
                    {column.comparable ? 'Comparable' : 'Not comparable'}
                  </span>
                  {column.reason ? <small>{column.reason}</small> : null}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div
        className="ledger-cards-scroll"
        role="region"
        aria-label="Quotes, one card per supplier"
        tabIndex={0}
      >
        <ul className="ledger-cards" aria-label="Quotes">
          {ledger.columns.map((column, index) => (
            <li key={column.id}>
              <article className="ledger-card" aria-label={column.supplier}>
                <header>
                  <b lang={column.supplierLang}>{column.supplier}</b>
                  {column.place ? <small>{column.place}</small> : null}
                  {column.trust ? <FactLabel label={column.trust} /> : null}
                  {column.historical ? (
                    <small className="ledger-earlier">Earlier quote</small>
                  ) : null}
                </header>
                <dl>
                  {shown.map((row) => (
                    <div key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>
                        <Cell cell={row.cells[index]!} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <footer>
                  <span className="ledger-badge" data-ok={column.comparable ? 'true' : 'false'}>
                    {column.comparable ? 'Comparable' : 'Not comparable'}
                  </span>
                  {column.reason ? <small>{column.reason}</small> : null}
                </footer>
              </article>
            </li>
          ))}
        </ul>
      </div>

      <div className="ledger-foot">
        <p className="ledger-sum">
          <b>
            {count} {count === 1 ? 'quote' : 'quotes'}
          </b>{' '}
          · {ledger.comparable} comparable · {ledger.notComparable} not comparable
        </p>
        <span className="ledger-foot-actions">
          <label className="ledger-toggle" htmlFor={toggleId}>
            <input
              id={toggleId}
              type="checkbox"
              checked={differencesOnly}
              onChange={(event) => setDifferencesOnly(event.target.checked)}
            />
            Show Only Differences
          </label>
          {ledger.earlier > 0 || includeEarlier ? (
            <button
              type="button"
              className="text-link"
              aria-pressed={includeEarlier}
              onClick={() => setIncludeEarlier((v) => !v)}
            >
              {includeEarlier ? 'Hide Earlier Quotes' : `Show Earlier Quotes (${ledger.earlier})`}
            </button>
          ) : null}
          {hiddenTerms > 0 ? (
            <button
              type="button"
              className="text-link"
              aria-pressed={allTerms}
              onClick={() => setAllTerms((v) => !v)}
            >
              {allTerms ? 'Show Key Terms' : `See All ${ledger.rows.length} Terms`}
            </button>
          ) : null}
          {more}
        </span>
      </div>
    </section>
  );
}
