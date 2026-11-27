'use client';
import { changesNotSaved, reviewAndSave } from '../../lib/route-pack-editor-words';

// ADR-093 Phase 3, PR 2b: the unsaved bar, the last block of the editor, sticky at the bottom of it (never the page's bottom
// area: this is a data screen). Drawn only while something is staged. The count is words ("3 changes not saved"), the one
// primary is "Review and Save (3)", and "Discard Changes" is a quiet text button at every width in PR 2b. Narrow, the count and
// Discard Changes share the first line and the primary has the second; from 40 rem all three stand on one line, the primary last.
export function UnsavedBar({
  count,
  onReview,
  onDiscard,
}: {
  count: number;
  onReview: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="route-bar" role="group" aria-label="Unsaved changes">
      <p className="route-bar-count">{changesNotSaved(count)}</p>
      {/* In a span of its own: the desk makes every standalone button on a phone fill its line, and this one is a quiet link. */}
      <span className="route-bar-discard">
        <button type="button" className="text-link" onClick={onDiscard}>
          Discard Changes
        </button>
      </span>
      <button type="button" className="primary-link" onClick={onReview}>
        {reviewAndSave(count)}
      </button>
    </div>
  );
}
