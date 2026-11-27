'use client';
import { ShowMoreList } from './show-more';
import './change-summary.css';

// A change summary (ADR-093 Phase 3, PR 2b): a count line and the changes in words, so every confirmation reads the same. It
// draws what it is given: the lines are already words ("Added: Working week"). No colour, no icon; the words carry the
// meaning. A long list folds behind "Show all N changes" and nothing is removed.
export type ChangeCounts = { added: number; changed: number; removed: number };
/** "Added 2, changed 1, removed 0". */
export const countsLine = (counts: ChangeCounts) =>
  `Added ${counts.added}, changed ${counts.changed}, removed ${counts.removed}`;

export function ChangeSummary({
  counts,
  lines,
  limit = 6,
  noun = 'changes',
}: {
  /** Left out, no count line is drawn. */
  counts?: ChangeCounts;
  lines: string[];
  /** How many lines show before the rest fold. */
  limit?: number;
  /** The plural noun of "Show all 9 changes". */
  noun?: string;
}) {
  return (
    <div className="ux-change-summary">
      {counts ? <p className="ux-change-counts">{countsLine(counts)}</p> : null}
      {lines.length ? (
        <ShowMoreList limit={limit} noun={noun} className="ux-change-lines">
          {lines.map((line, index) => (
            <li key={`${index}-${line}`} dir="auto">
              {line}
            </li>
          ))}
        </ShowMoreList>
      ) : null}
    </div>
  );
}
