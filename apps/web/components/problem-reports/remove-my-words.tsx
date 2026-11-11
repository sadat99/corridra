'use client';
import { useRef, useState } from 'react';
import './problem-reports.css';
import { Dialog } from '../ux/dialog';
import { removalFailure, removeOwnWords, type FailureLine } from '../../lib/problem-report-client';
import type { ReportLinks } from '../../lib/problem-report-links';
import { removalWords } from '../../lib/problem-report-words';
import { ReportFailure } from './failure-line';

/**
 * The customer's own removal of the words of their problem reports: a closed disclosure, a button, and a confirmation
 * that says it cannot be undone. The count shown is the one in the answer, after the removal and from nowhere else.
 * One command id covers every retry of an answer that did not arrive; a finished removal starts the next one afresh.
 */
export function RemoveMyWords({
  headers,
  links,
  onRemoved,
}: {
  headers: Record<string, string>;
  links: ReportLinks;
  /** Called after a removal the server confirmed, so the list can be read again. */
  onRemoved: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureLine | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const commandId = useRef<string | null>(null);

  async function remove() {
    if (busy) return;
    commandId.current ??= crypto.randomUUID();
    setBusy(true);
    setFailure(null);
    const reply = await removeOwnWords(headers, commandId.current);
    setBusy(false);
    if (!reply.ok) {
      setFailure(removalFailure(reply.status));
      return;
    }
    commandId.current = null;
    setAsking(false);
    setResult(removalWords.done(reply.value.removed));
    onRemoved();
  }

  return (
    <details>
      <summary>{removalWords.summary}</summary>
      <div className="pr-column">
        <div className="pr-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setFailure(null);
              setResult(null);
              setAsking(true);
            }}
          >
            {removalWords.button}
          </button>
        </div>
      </div>
      <p role="status" className="pr-status">
        {result}
      </p>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={removalWords.title}
        locked={busy}
      >
        <p>{removalWords.body}</p>
        {failure ? <ReportFailure failure={failure} links={links} /> : null}
        <div className="ux-dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            data-autofocus=""
            disabled={busy}
            onClick={() => setAsking(false)}
          >
            {removalWords.keep}
          </button>
          <button
            type="button"
            className="primary-link"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? 'Please Wait…' : removalWords.confirm}
          </button>
        </div>
      </Dialog>
    </details>
  );
}
