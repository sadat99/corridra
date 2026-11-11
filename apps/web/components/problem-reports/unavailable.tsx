import { failureWords } from '../../lib/problem-report-words';

/** What a page says while Report a Problem is not offered (its module or the customer's own word removal is missing). */
export function ProblemReportsUnavailable({ filing = false }: { filing?: boolean }) {
  return (
    <>
      <p role="status">{failureWords.unavailable}</p>
      {filing ? <p>{failureWords.unavailableFile}</p> : null}
    </>
  );
}
