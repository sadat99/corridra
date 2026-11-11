'use client';
import { useEffect, useRef } from 'react';
import type { FailureLine } from '../../lib/problem-report-client';
import { failureWords } from '../../lib/problem-report-words';
import type { ReportLinks } from '../../lib/problem-report-links';

/**
 * A refusal or failure said next to the control that met it. It takes focus when it appears, so it is read at once, and
 * it offers the one way out the answer calls for: signing in again, going back, or reading the reports.
 */
export function ReportFailure({
  failure,
  links,
  listLabel,
}: {
  failure: FailureLine;
  links: ReportLinks;
  /** The words of the link to the person's reports, where the answer leads there. */
  listLabel?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => ref.current?.focus(), [failure]);
  return (
    <>
      <p ref={ref} tabIndex={-1} role="alert" className="ux-error-summary">
        {failure.message}
      </p>
      {failure.link === 'sign_in' ? (
        <a className="primary-link" href={links.signIn}>
          {failureWords.signIn}
        </a>
      ) : null}
      {failure.link === 'return' ? (
        <a className="text-link" href={links.home}>
          {links.homeLabel}
        </a>
      ) : null}
      {failure.link === 'list' && listLabel ? (
        <a className="text-link" href={links.list}>
          {listLabel}
        </a>
      ) : null}
    </>
  );
}
