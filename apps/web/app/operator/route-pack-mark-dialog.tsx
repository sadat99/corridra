'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { SectionNumber } from '@corridra/domain/route-pack-standard';
import { Dialog } from '../../components/ux/dialog';
import { markNoteIssue } from '../../lib/route-pack-editor-section';
import { markDialogWords } from '../../lib/route-pack-editor-words';
import { TextArea } from './route-pack-value-controls';

// ADR-093 Phase 3, PR 2c: Mark Section Not Applicable (spec 8.6). One required Reason, which is the note of the mark. The dialog
// refuses in words and focuses the field; on a good reason it hands the trimmed note to `onStage` and closes. The page stages
// the mark (stageMark), says "Change kept. N changes not saved." and moves focus to its status line. The dialog holds no stage.

export type MarkDialogProps = {
  open: boolean;
  onClose: () => void;
  section: { number: SectionNumber; name: string };
  /** Called with the trimmed reason once it passes the rules; the dialog then closes itself. */
  onStage: (note: string) => void;
  /** Where focus goes when the row that opened the dialog is gone (the More button, or the status line). */
  returnFocusTo?: () => HTMLElement | null;
};

export function RouteMarkDialog({
  open,
  onClose,
  section,
  onStage,
  returnFocusTo,
}: MarkDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={markDialogWords.title}
      returnFocusTo={returnFocusTo}
    >
      <MarkForm section={section} onClose={onClose} onStage={onStage} />
    </Dialog>
  );
}

function MarkForm({
  section,
  onClose,
  onStage,
}: Pick<MarkDialogProps, 'section' | 'onClose' | 'onStage'>) {
  const id = `mark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The Reason takes focus when the dialog opens (the dialog focuses the control marked data-autofocus).
  useEffect(() => {
    root.current?.querySelector('textarea')?.setAttribute('data-autofocus', '');
  }, []);
  function stage() {
    const issue = markNoteIssue(note, section.number);
    if (issue) {
      setError(issue);
      root.current?.querySelector<HTMLElement>('textarea')?.focus();
      return;
    }
    onStage(note.trim());
    onClose();
  }
  return (
    <div className="route-dialog" ref={root}>
      <p>{markDialogWords.sectionLine(section.number, section.name)}</p>
      <TextArea
        id={`${id}-reason`}
        label={markDialogWords.reason}
        value={note}
        onChange={(value) => {
          setNote(value);
          setError(null);
        }}
        limit={500}
        error={error}
      />
      <p className="route-edit-quiet">{markDialogWords.statement}</p>
      <div className="route-dialog-actions">
        <button type="button" className="primary-link" onClick={stage}>
          {markDialogWords.confirm}
        </button>
        <button type="button" className="text-link" onClick={onClose}>
          {markDialogWords.cancel}
        </button>
      </div>
    </div>
  );
}
