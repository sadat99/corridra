'use client';
import { useEffect, useId, useRef } from 'react';
import { CorridraIcon } from '../../components/corridra-icon';
import { ChoiceButton, ChoiceRow } from '../../components/ux/choice-chip';
import {
  answerWords,
  coveredHelp,
  type FactAnswer,
  type FactDraft,
  type FormField,
} from '../../lib/route-pack-editor-fact-form';
import { pendingClears, removeFieldHelp } from '../../lib/route-pack-editor-words';
import type { OpenRow } from './route-pack-editor-stage-store';
import { SourceStep, TextArea, ValueControl } from './route-pack-value-controls';

// ADR-093 Phase 3, PR 2b: the two-step editor of one field row, in place (spec 8.8). Step 1: the answer (three answer rows) and
// the value control of its type, or the reason of Not applicable. Step 2 (Filled only): the source and the dates. The editor
// draws the draft it is given and reports every change; the shell validates on Next and Keep Change and hands back what was
// refused, so the rule lives in one place (factFromDraft). Focus: the first answer on opening, the step line after Next or
// Back, the first invalid control after a refusal.
export function RouteFactEditor({
  label,
  field,
  answers,
  covered,
  savedFilled,
  open,
  today,
  caution,
  onChange,
  onNext,
  onBack,
  onKeep,
  onCancel,
}: {
  label: string;
  field: FormField;
  answers: FactAnswer[];
  /** The row is covered by a section marked Not applicable: Pending is not offered and the help says why. */
  covered: boolean;
  /** The row has a saved value now (Pending would clear it). */
  savedFilled: boolean;
  open: OpenRow;
  today: string;
  /** The caution words when this answer turns a Core field Pending on a live route; null otherwise. */
  caution: string | null;
  onChange: (draft: FactDraft) => void;
  onNext: () => void;
  onBack: () => void;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const id = `edit-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const stepLine = useRef<HTMLParagraphElement>(null);
  const { draft, step, shown } = open;
  const set = (change: Partial<FactDraft>) => onChange({ ...draft, ...change });
  const two = draft.answer === 'FILLED';
  // The first answer takes focus when the row opens.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('.ux-choice')?.focus();
  }, []);
  // The step line takes focus when the step changes (Next, Back), not when the row opens.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    stepLine.current?.focus();
  }, [step]);
  // The first invalid control takes focus each time the shell raises a refusal.
  useEffect(() => {
    if (open.focus === 0) return;
    root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [open.focus]);
  const noteError = shown.find((refusal) => refusal.field === 'note')?.message ?? null;
  const formError = shown.find((refusal) => refusal.field === 'form')?.message ?? null;
  const progress =
    step === 2
      ? 'Step 2 of 2: Source'
      : two
        ? 'Step 1 of 2: Answer · Next: Source'
        : 'Step 1 of 1: Answer';
  return (
    <div className="route-edit" role="group" aria-label={`Edit ${label}`} ref={root}>
      <p className="route-edit-step" tabIndex={-1} ref={stepLine}>
        {progress}
      </p>
      {step === 1 ? (
        <>
          <p className="route-edit-question" id={`${id}-answer`}>
            Answer for {label}
          </p>
          <ChoiceRow labelledBy={`${id}-answer`}>
            {answers.map((answer) => (
              <ChoiceButton
                key={answer}
                chosen={draft.answer === answer}
                onClick={() => set({ answer })}
              >
                {answerWords[answer]}
              </ChoiceButton>
            ))}
          </ChoiceRow>
          {covered ? <p className="route-edit-quiet">{coveredHelp}</p> : null}
          {draft.answer === 'FILLED' ? (
            <ValueControl id={id} field={field} draft={draft} set={set} refusals={shown} />
          ) : draft.answer === 'NOT_APPLICABLE' ? (
            <TextArea
              id={`${id}-note`}
              label="Reason"
              value={draft.note}
              onChange={(note) => set({ note })}
              limit={1000}
              error={noteError}
            />
          ) : draft.answer === 'REMOVE' ? (
            <p className="route-edit-quiet">{removeFieldHelp}</p>
          ) : savedFilled ? (
            <p className="route-edit-quiet">{pendingClears}</p>
          ) : null}
          {draft.answer === 'PENDING' && caution ? (
            <p className="route-edit-caution" role="status">
              <CorridraIcon name="alert" />
              <span>{caution}</span>
            </p>
          ) : null}
        </>
      ) : (
        <SourceStep id={id} draft={draft} set={set} refusals={shown} today={today} />
      )}
      {formError ? (
        <p className="route-edit-quiet" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="route-edit-actions">
        {step === 1 && two ? (
          <button type="button" className="primary-link" onClick={onNext}>
            Next
          </button>
        ) : (
          <button type="button" className="primary-link" onClick={onKeep}>
            Keep Change
          </button>
        )}
        {step === 2 ? (
          <button type="button" className="text-link" onClick={onBack}>
            Back
          </button>
        ) : null}
        <button type="button" className="text-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
