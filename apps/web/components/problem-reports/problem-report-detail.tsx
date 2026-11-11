'use client';
import { useEffect, useState } from 'react';
import type { ProblemReportDetail } from '@corridra/auth/problem-reports';
import './problem-reports.css';
import { whenWords } from '../../app/account/workspace-lifecycle-client';
import {
  readFailure,
  readProblemReport,
  referenceAsked,
  type FailureLine,
  type ReportTarget,
} from '../../lib/problem-report-client';
import type { ReportLinks } from '../../lib/problem-report-links';
import {
  categoryWords,
  detailWords,
  formWords,
  listWords,
  noteFrom,
  statusLabels,
  statusMeaning,
} from '../../lib/problem-report-words';
import { ReportFailure } from './failure-line';

type State =
  | { phase: 'loading' }
  | { phase: 'failed'; failure: FailureLine; retry: boolean }
  | { phase: 'ready'; report: ProblemReportDetail };

/**
 * One of the person's own problem reports with every status change and every note, in order. A reference that is not
 * theirs, or does not exist, or could not be one, is told in the same words.
 */
export function ProblemReportDetailView({
  target,
  links,
  reference,
}: {
  target: ReportTarget;
  links: ReportLinks;
  reference: string;
}) {
  const asked = referenceAsked(reference);
  const [state, setState] = useState<State>(
    asked
      ? { phase: 'loading' }
      : { phase: 'failed', failure: { message: detailWords.notFound, link: null }, retry: false },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!asked) return;
    let cancelled = false;
    void readProblemReport(target, reference).then((reply) => {
      if (cancelled) return;
      setState(
        reply.ok
          ? { phase: 'ready', report: reply.value }
          : {
              phase: 'failed',
              failure: readFailure(reply.status, listWords.loadError, detailWords.notFound),
              retry: reply.status !== 404,
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [target, reference, asked, attempt]);

  const back = (
    <a className="text-link" href={links.list}>
      {formWords.seeList}
    </a>
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
          {state.retry ? (
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
          ) : null}
          {back}
        </div>
      </div>
    );

  const { report } = state;
  return (
    <div className="pr-column">
      <p>
        <code>{report.reference}</code>{' '}
        <span className="ux-badge">{statusLabels[report.status]}</span>
      </p>
      <p>{statusMeaning(report.status, target.side)}</p>
      <section aria-labelledby="pr-told">
        <h2 id="pr-told">{detailWords.told}</h2>
        <dl className="pr-summary">
          <div>
            <dt>{detailWords.category}</dt>
            <dd>{categoryWords[report.category].label}</dd>
          </div>
          {'removed' in report.words ? (
            <div>
              <dt>{detailWords.details}</dt>
              <dd>{listWords.wordsGone}</dd>
            </div>
          ) : (
            <>
              <div>
                <dt>{detailWords.where}</dt>
                <dd>
                  {report.words.pageKind === 'this_page' ? (
                    <>
                      {detailWords.thisPage}: <code>{report.words.page}</code>
                    </>
                  ) : (
                    <>
                      {detailWords.anotherPage}: {report.words.page}
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>{detailWords.details}</dt>
                <dd>{report.words.detail ?? formWords.nothingAdded}</dd>
              </div>
            </>
          )}
        </dl>
      </section>
      <section aria-labelledby="pr-history">
        <h2 id="pr-history">{detailWords.history}</h2>
        <ol className="pr-history">
          {report.history.map((entry, index) => (
            <li key={`${index}-${entry.createdAt}`}>
              <strong>{statusLabels[entry.state]}</strong>{' '}
              <time dateTime={entry.createdAt}>{whenWords(entry.createdAt)}</time>
              {entry.note ? (
                <>
                  <br />
                  <em>{noteFrom(target.side)}:</em> {entry.note}
                </>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      <div className="pr-actions">{back}</div>
    </div>
  );
}
