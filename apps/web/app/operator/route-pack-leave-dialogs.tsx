'use client';
import { Dialog } from '../../components/ux/dialog';
import { discardWords, leaveKept, leaveTitle, leaveWords } from '../../lib/route-pack-editor-words';

// ADR-093 Phase 3, PR 2b: the two small questions of the editor. Both put focus on "Keep Editing", the safe choice, and neither
// is a way to lose edits by accident: Discard Changes removes the staged edits and the tab's copy; Leave Route keeps the copy.

export function DiscardDialog({
  open,
  count,
  onKeep,
  onDiscard,
  returnFocusTo,
}: {
  open: boolean;
  count: number;
  onKeep: () => void;
  onDiscard: () => void;
  returnFocusTo: () => HTMLElement | null;
}) {
  return (
    <Dialog open={open} onClose={onKeep} title="Discard Changes" returnFocusTo={returnFocusTo}>
      <div className="route-dialog">
        <p>{discardWords(count)}</p>
        <div className="route-dialog-actions">
          <button type="button" className="primary-link" data-autofocus onClick={onKeep}>
            Keep Editing
          </button>
          <button type="button" className="text-link" onClick={onDiscard}>
            Discard Changes
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function LeaveDialog({
  open,
  count,
  kept,
  onKeep,
  onLeave,
}: {
  open: boolean;
  count: number;
  /** The edits are in the tab's storage, so they come back if the person returns to this route. */
  kept: boolean;
  onKeep: () => void;
  onLeave: () => void;
}) {
  return (
    <Dialog open={open} onClose={onKeep} title={leaveTitle}>
      <div className="route-dialog">
        <p>{leaveWords(count, kept)}</p>
        {kept ? <p>{leaveKept}</p> : null}
        <div className="route-dialog-actions">
          <button type="button" className="primary-link" data-autofocus onClick={onKeep}>
            Keep Editing
          </button>
          <button type="button" className="text-link" onClick={onLeave}>
            Leave Route
          </button>
        </div>
      </div>
    </Dialog>
  );
}
