'use client';
import { useCallback, useEffect, useState } from 'react';
import { problemReportStatuses } from '@corridra/domain/problem-report';
import type { ProblemReportListItem } from '@corridra/auth/problem-reports';
import './problem-reports.css';
import { whenWords } from '../../app/account/workspace-lifecycle-client';
import { EmptyState } from '../ux/empty-state';
import { RowLink, RowList } from '../ux/row-list';
import {
  readFailure,
  readProblemReports,
  type FailureLine,
  type ReportTarget,
} from '../../lib/problem-report-client';
import type { ReportLinks } from '../../lib/problem-report-links';
import {
  categoryWords,
  listWords,
  statusLabels,
  statusMeaning,
} from '../../lib/problem-report-words';
import { ReportFailure } from './failure-line';

// The newest five come first, then older ones on request: a person with a long history never loads it all.
export const listPageSize = 5;

type State =
  | { phase: 'loading' }
  | { phase: 'failed'; failure: FailureLine }
  | { phase: 'ready'; items: ProblemReportListItem[]; nextBefore: number | null };

/**
 * The person's own problem reports, newest first. The customer route has no total, so none is shown. `reload` changes when
 * something elsewhere on the page (removing words) means the list must be read again.
 */
export function ProblemReportList({
  target,
  links,
  reload = 0,
}: {
  target: ReportTarget;
  links: ReportLinks;
  reload?: number;
}) {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [older, setOlder] = useState<{ busy: boolean; failure: FailureLine | null }>({
    busy: false,
    failure: null,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void readProblemReports(target, listPageSize, null).then((reply) => {
      if (cancelled) return;
      setState(
        reply.ok
          ? { phase: 'ready', items: reply.value.items, nextBefore: reply.value.nextBefore ?? null }
          : { phase: 'failed', failure: readFailure(reply.status, listWords.loadError) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [target, attempt, reload]);

  const showOlder = useCallback(
    async (before: number) => {
      setOlder({ busy: true, failure: null });
      const reply = await readProblemReports(target, listPageSize, before);
      if (!reply.ok) {
        setOlder({ busy: false, failure: readFailure(reply.status, listWords.loadError) });
        return;
      }
      setOlder({ busy: false, failure: null });
      setState((current) =>
        current.phase === 'ready'
          ? {
              phase: 'ready',
              items: [...current.items, ...reply.value.items],
              nextBefore: reply.value.nextBefore ?? null,
            }
          : current,
      );
    },
    [target],
  );

  if (state.phase === 'loading')
    return (
      <p role="status" className="pr-meta">
        {listWords.loading}
      </p>
    );
  if (state.phase === 'failed')
    return (
      <div className="pr-column">
        <ReportFailure failure={state.failure} links={links} />
        <div className="pr-actions">
          <button
            type="button"
            className="primary-link"
            onClick={() => {
              setState({ phase: 'loading' });
              setAttempt((count) => count + 1);
            }}
          >
            {listWords.tryAgain}
          </button>
        </div>
      </div>
    );
  if (state.items.length === 0)
    return (
      <EmptyState
        icon="document"
        action={
          <a className="primary-link" href={links.form}>
            {listWords.report}
          </a>
        }
      >
        {listWords.empty}
      </EmptyState>
    );
  const before = state.nextBefore;
  return (
    <div className="pr-column">
      <RowList
        label={listWords.listLabel}
        title={listWords.columns.reference}
        columns={[
          { name: listWords.columns.status },
          { name: listWords.columns.category },
          { name: listWords.columns.filed },
        ]}
      >
        {state.items.map((item) => (
          <RowLink
            key={item.reference}
            href={links.detail(item.reference)}
            title={
              <>
                <code>{item.reference}</code>
                {item.wordsRemoved ? <span className="pr-gone">{listWords.wordsGone}</span> : null}
              </>
            }
            cells={[
              { name: listWords.columns.status, value: statusLabels[item.status], status: true },
              { name: listWords.columns.category, value: categoryWords[item.category].label },
              { name: listWords.columns.filed, value: whenWords(item.filedAt) },
            ]}
          />
        ))}
      </RowList>
      {older.failure ? <ReportFailure failure={older.failure} links={links} /> : null}
      {before !== null ? (
        <div className="pr-actions">
          <button
            type="button"
            className="text-link"
            disabled={older.busy}
            onClick={() => void showOlder(before)}
          >
            {older.busy ? listWords.loading : listWords.showOlder}
          </button>
        </div>
      ) : null}
      <details>
        <summary>{listWords.meaningTitle}</summary>
        <dl className="pr-meanings">
          {problemReportStatuses.map((status) => (
            <div key={status}>
              <dt>{statusLabels[status]}</dt>
              <dd>{statusMeaning(status, target.side)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
