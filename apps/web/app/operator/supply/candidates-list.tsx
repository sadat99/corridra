'use client';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '../../../components/ux/empty-state';
import { SegmentedFilter } from '../../../components/ux/segmented-filter';
import { formatDate } from '../../../lib/ux/format';
import { supplyListLimit } from '@corridra/domain/supply-sources';
import {
  firstRows,
  listLimitWords,
  methodWords,
  reviewWords,
  sourceKindWords,
  supplyBase,
  withWorkspace,
} from '../../../lib/supply-screens';
import { Loading, PersonalDataLine, ReadFailure, type Loaded } from './supply-ui';

export type Candidate = {
  id: string;
  companyName: string | null;
  country: string;
  sourceLabel: string;
  sourceKind: string;
  method: string;
  observedAt: string;
  retentionUntil: string;
  expired: boolean;
  warnings: string[];
  latestReview: { decision: string; reasonCode: string; at: string } | null;
};

type Filter = 'all' | 'not_reviewed' | 'qualified' | 'wrong_fit' | 'expired';
export const nameCheckWords =
  'This name has no company form such as Ltd or GmbH. It may be a person, such as a sole trader. Look at it before qualifying.';

/** One word for where a candidate stands. Retention decides expiry, whatever the last review said. */
export const candidateStatus = (c: Pick<Candidate, 'expired' | 'latestReview'>) =>
  c.expired
    ? 'Expired'
    : c.latestReview
      ? (reviewWords[c.latestReview.decision] ?? c.latestReview.decision)
      : 'Not reviewed';
const filterOf = (c: Candidate): Filter => {
  const status = candidateStatus(c);
  return status === 'Qualified'
    ? 'qualified'
    : status === 'Wrong fit'
      ? 'wrong_fit'
      : status === 'Expired'
        ? 'expired'
        : status === 'Not reviewed'
          ? 'not_reviewed'
          : 'all';
};

export function CandidatesList({
  tenant,
  missionId,
  state,
  hasProfile,
}: {
  tenant: string;
  missionId: string;
  state: Loaded<{ candidates: Candidate[] }>;
  hasProfile: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [shown, setShown] = useState<number>(firstRows.candidates);
  const all = state.data?.candidates ?? [];
  const count = (f: Filter) => all.filter((c) => filterOf(c) === f).length;
  const rows = filter === 'all' ? all : all.filter((c) => filterOf(c) === filter);
  return (
    <div className="supply-flow">
      <PersonalDataLine />
      {state.loading && !state.data ? <Loading words="Loading candidates." /> : null}
      {state.error ? <ReadFailure error={state.error} onRetry={state.reload} /> : null}
      {!hasProfile ? (
        <p className="supply-quiet">
          This mission has no research profile yet, so candidates cannot be added.
        </p>
      ) : null}
      {state.data && all.length === 0 ? (
        <EmptyState icon="mission">
          No candidates for this mission yet. Add one by hand or import a file.
        </EmptyState>
      ) : null}
      {all.length > 0 ? (
        <>
          <div className="supply-filter-row">
            <SegmentedFilter<Filter>
              label="Show"
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setShown(firstRows.candidates);
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'not_reviewed', label: 'Not Reviewed' },
                { value: 'qualified', label: 'Qualified' },
                { value: 'wrong_fit', label: 'Wrong Fit' },
                { value: 'expired', label: 'Expired' },
              ]}
            />
            <p className="supply-quiet" role="status">
              {count('qualified')} qualified, {count('wrong_fit')} wrong fit, {count('expired')}{' '}
              expired, {count('not_reviewed')} not reviewed, of {all.length} candidates.
            </p>
          </div>
          <ul className="supply-list supply-list-wide" aria-label="Candidates">
            {rows.slice(0, shown).map((c) => (
              <li key={c.id} className="supply-item">
                <p className="supply-item-title">
                  {c.companyName ? (
                    <Link
                      prefetch={false}
                      className="text-link"
                      dir="auto"
                      href={withWorkspace(
                        `${supplyBase}/missions/${missionId}/candidates/${c.id}`,
                        tenant,
                      )}
                    >
                      {c.companyName}
                    </Link>
                  ) : (
                    <Link
                      prefetch={false}
                      className="text-link"
                      href={withWorkspace(
                        `${supplyBase}/missions/${missionId}/candidates/${c.id}`,
                        tenant,
                      )}
                    >
                      Company name removed after retention
                    </Link>
                  )}{' '}
                  <span className="ux-badge">{candidateStatus(c)}</span>
                </p>
                <dl className="supply-facts">
                  <div>
                    <dt>Source</dt>
                    <dd>
                      {c.sourceLabel}, {methodWords[c.method] ?? c.method}
                    </dd>
                  </div>
                  <div>
                    <dt>Kind</dt>
                    <dd>{sourceKindWords[c.sourceKind] ?? c.sourceKind}</dd>
                  </div>
                  <div>
                    <dt>Observed</dt>
                    <dd>{formatDate(c.observedAt)}</dd>
                  </div>
                  <div>
                    <dt>Keep Until</dt>
                    <dd>
                      {c.expired
                        ? `Passed ${formatDate(c.retentionUntil)}`
                        : formatDate(c.retentionUntil)}
                    </dd>
                  </div>
                </dl>
                {c.warnings.includes('personal_name_check') ? (
                  <p className="supply-check">
                    <span className="ux-badge">Name check</span> {nameCheckWords}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {rows.length > shown ? (
            <div className="ux-show-more supply-more">
              <p role="status">
                Showing {shown} of {rows.length} candidates.
              </p>
              <button type="button" className="text-link" onClick={() => setShown(shown + 5)}>
                Show More
              </button>
            </div>
          ) : null}
          {all.length >= supplyListLimit ? (
            <p className="supply-quiet supply-inline">{listLimitWords.candidates}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
