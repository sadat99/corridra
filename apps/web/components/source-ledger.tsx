'use client';

// The Source room's quote comparison (approved work rooms, 5 Nov 2026; UI/UX.v4 row "Compare", 20 Nov 2026). One
// shared table (`CompareGrid`): a column per supplier, the row labels frozen while the suppliers scroll sideways,
// the key machinery terms first and every other term one tap away. The model is lib/source-ledger.ts: it adds no
// verdict, converts no currency and keeps a missing term missing.
import type { MissionExperience } from '@corridra/delivery/report';
import { useMemo, useState, type ReactNode } from 'react';
import { sourceLedger, type LedgerRow } from '../lib/source-ledger';
import { CompareGrid } from './ux/compare-grid';
import { useLanguage } from './language-provider';
import { translate } from '../lib/i18n/messages';
import './source-ledger.css';

export function SourceLedger({
  experience,
  language = 'en',
  notice,
  more,
}: {
  experience: MissionExperience;
  language?: string;
  /** The missing terms notice with its one action, placed under the table and the money line. */
  notice?: ReactNode;
  /** One more action for the foot of the comparison (the Room's "Show the requirement..." control). */
  more?: ReactNode;
}) {
  const [allTerms, setAllTerms] = useState(false);
  const [includeEarlier, setIncludeEarlier] = useState(false);
  const { locale } = useLanguage();
  const ledger = useMemo(
    () => sourceLedger(experience, { includeEarlier, language }),
    [experience, includeEarlier, language],
  );
  if (ledger.columns.length === 0)
    return (
      <section className="ledger" aria-label={translate(locale, 'compare.heading')}>
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
  const shown = ledger.rows.filter((row) => allTerms || row.key);
  const hiddenTerms = ledger.rows.length - keyRows.length;
  // Terms no quote states are one row that still names every term, so a short comparison is not a column of
  // "Not stated". It is data driven: a term that any quote states is its own row again. One such term stays a row.
  const missingEverywhere = (row: LedgerRow) =>
    row.cells.every((cell) => !cell.excluded && (cell.value === null || cell.value === undefined));
  const unstated = shown.filter(missingEverywhere);
  const folded = unstated.length >= 2;
  const rowsShown = folded ? shown.filter((row) => !missingEverywhere(row)) : shown;
  return (
    <section className="ledger" aria-label={translate(locale, 'compare.heading')}>
      <CompareGrid
        locale={locale}
        markLang={locale !== 'en'}
        // The Room's other parts are h3 under its h2 lens area, so the comparison heading is one of them.
        headingLevel={3}
        columns={ledger.columns}
        rows={rowsShown}
        note={
          folded
            ? { label: 'Not stated yet', text: unstated.map((row) => row.label).join(', ') }
            : undefined
        }
        shippingExcluded={ledger.shippingExcluded}
        foot={
          <>
            {notice}
            <div className="ledger-foot">
              <span className="ledger-foot-actions">
                {ledger.earlier > 0 || includeEarlier ? (
                  <button
                    type="button"
                    className="text-link"
                    aria-pressed={includeEarlier}
                    onClick={() => setIncludeEarlier((v) => !v)}
                  >
                    {includeEarlier
                      ? 'Hide Earlier Quotes'
                      : `Show Earlier Quotes (${ledger.earlier})`}
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
          </>
        }
      />
    </section>
  );
}
