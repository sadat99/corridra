'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { ContentFact, FactType, SectionNumber } from '@corridra/domain/route-pack-standard';
import { FieldError } from '../../components/field-error';
import { ChoiceButton, ChoiceRow } from '../../components/ux/choice-chip';
import { Dialog } from '../../components/ux/dialog';
import {
  answerWords,
  customKeyFor,
  emptyDraft,
  factFromDraft,
  type CustomDefinition,
  type FactDraft,
  type FormField,
  type Refusal,
} from '../../lib/route-pack-editor-fact-form';
import { addCustomPlan } from '../../lib/route-pack-editor-section';
import { customDialogWords, customTypeOptions } from '../../lib/route-pack-editor-words';
import { SourceStep, TextArea, ValueControl } from './route-pack-value-controls';

// ADR-093 Phase 3, PR 2c: Add Custom Field (spec 8.8), two steps. Step 1 Define asks Label, Type and, for a choice or a list,
// Allowed values; the section is the section the menu was opened from and is shown as a line. Step 2 Value asks the answer
// (Filled or Not applicable) with the same value controls as a row. "Add Field" hands the key, the definition and the fact to
// `onAdd` (the page stages it with stageFact); nothing is saved here. Closing drops what was typed, with no question.

export type CustomDialogProps = {
  open: boolean;
  onClose: () => void;
  section: { number: SectionNumber; name: string };
  /** Every key the route has, saved or staged, and the keys of custom labels: a label whose key is taken is refused. */
  takenKeys: Iterable<string>;
  /** Today as YYYY-MM-DD, for the dates of the source. */
  today: string;
  onAdd: (key: string, definition: CustomDefinition, fact: ContentFact) => void;
  /** Where focus goes when the row that opened the dialog is gone (the More button, or the status line). */
  returnFocusTo?: () => HTMLElement | null;
};

export function RouteCustomDialog({
  open,
  onClose,
  section,
  takenKeys,
  today,
  onAdd,
  returnFocusTo,
}: CustomDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={customDialogWords.title}
      returnFocusTo={returnFocusTo}
    >
      <CustomForm
        section={section}
        takenKeys={takenKeys}
        today={today}
        onAdd={onAdd}
        onClose={onClose}
      />
    </Dialog>
  );
}

type Defined = { key: string; definition: CustomDefinition; field: FormField };
const hasAllowed = (type: string) => type === 'choice' || type === 'list';
const errorOf = (refusals: Refusal[], part: Refusal['field']) =>
  refusals.find((refusal) => refusal.field === part)?.message ?? null;

function CustomForm({
  section,
  takenKeys,
  today,
  onAdd,
  onClose,
}: Omit<CustomDialogProps, 'open' | 'returnFocusTo'>) {
  const id = `custom-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const stepLine = useRef<HTMLParagraphElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FactType>('text');
  const [allowedText, setAllowedText] = useState('');
  const [defined, setDefined] = useState<Defined | null>(null);
  const [draft, setDraft] = useState<FactDraft>(() => emptyDraft(today));
  const [shown, setShown] = useState<Refusal[]>([]);
  const [raised, setRaised] = useState(0);
  const [stepMoved, setStepMoved] = useState(0);
  // The Label takes focus when the dialog opens (the dialog focuses the control marked data-autofocus).
  useEffect(() => {
    root.current?.querySelector('input')?.setAttribute('data-autofocus', '');
  }, []);
  // The step line takes focus after Next or Back; the first invalid control takes it after a refusal.
  useEffect(() => {
    if (stepMoved) stepLine.current?.focus();
  }, [stepMoved]);
  useEffect(() => {
    if (raised) root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [raised]);

  const usable = /[a-z0-9]/.test(label.normalize('NFKD').toLowerCase());
  const lines = allowedText.split('\n');
  const refuse = (refusals: Refusal[]) => {
    setShown(refusals);
    setRaised((n) => n + 1);
  };

  function next() {
    const plan = addCustomPlan({
      label,
      section: section.number,
      type,
      allowed: hasAllowed(type) ? lines : [],
      takenKeys,
    });
    if (!plan.ok) return refuse(plan.refusals);
    const same = defined && JSON.stringify(defined.definition) === JSON.stringify(plan.definition);
    if (!same) setDraft(emptyDraft(today));
    setDefined({ key: plan.key, definition: plan.definition, field: plan.field });
    setShown([]);
    setStep(2);
    setStepMoved((n) => n + 1);
  }
  function back() {
    setShown([]);
    setStep(1);
    setStepMoved((n) => n + 1);
  }
  function add() {
    if (!defined) return;
    const built = factFromDraft(defined.field, draft, today);
    if (!built.ok) return refuse(built.refusals);
    if (!built.fact) return;
    onAdd(defined.key, defined.definition, built.fact);
    onClose();
  }
  const set = (change: Partial<FactDraft>) => setDraft((current) => ({ ...current, ...change }));

  const labelError = errorOf(shown, 'text');
  const itemsError = errorOf(shown, 'items');
  const formError = errorOf(shown, 'form');
  const noteError = errorOf(shown, 'note');
  return (
    <div className="route-dialog" ref={root}>
      <p className="route-edit-step" tabIndex={-1} ref={stepLine}>
        {step === 1 ? customDialogWords.step1 : customDialogWords.step2}
      </p>
      <p className="route-edit-quiet">{customDialogWords.nothingSaved}</p>
      {step === 1 ? (
        <>
          <p>{customDialogWords.goesIn(section.number, section.name)}</p>
          <div className="field route-edit-field">
            <label htmlFor={`${id}-label`}>{customDialogWords.label}</label>
            <input
              id={`${id}-label`}
              dir="auto"
              autoComplete="off"
              value={label}
              aria-invalid={labelError ? true : undefined}
              aria-describedby={
                [usable ? `${id}-key` : null, labelError ? `${id}-label-error` : null]
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              onChange={(event) => {
                setLabel(event.target.value);
                setShown([]);
              }}
            />
            {usable ? (
              <p className="route-edit-quiet" id={`${id}-key`}>
                {customDialogWords.savedAs(customKeyFor(label))}
              </p>
            ) : null}
            {labelError ? <FieldError id={`${id}-label-error`}>{labelError}</FieldError> : null}
          </div>
          <div className="field route-edit-field">
            <label htmlFor={`${id}-type`}>{customDialogWords.type}</label>
            <select
              id={`${id}-type`}
              value={type}
              onChange={(event) => {
                setType(event.target.value as FactType);
                setShown([]);
              }}
            >
              {customTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {hasAllowed(type) ? (
            <div className="field route-edit-field">
              <label htmlFor={`${id}-allowed`}>{customDialogWords.allowed}</label>
              <textarea
                id={`${id}-allowed`}
                dir="auto"
                rows={4}
                value={allowedText}
                aria-invalid={itemsError ? true : undefined}
                aria-describedby={[`${id}-allowed-help`, itemsError ? `${id}-allowed-error` : null]
                  .filter(Boolean)
                  .join(' ')}
                onChange={(event) => {
                  setAllowedText(event.target.value);
                  setShown([]);
                }}
              />
              <p className="route-edit-quiet" id={`${id}-allowed-help`}>
                {customDialogWords.allowedHelp}
              </p>
              {itemsError ? <FieldError id={`${id}-allowed-error`}>{itemsError}</FieldError> : null}
            </div>
          ) : null}
          {formError ? <FieldError id={`${id}-form-error`}>{formError}</FieldError> : null}
        </>
      ) : defined ? (
        <>
          <p className="route-edit-question" id={`${id}-answer`}>
            {customDialogWords.answer}
          </p>
          <ChoiceRow labelledBy={`${id}-answer`}>
            {(['FILLED', 'NOT_APPLICABLE'] as const).map((answer) => (
              <ChoiceButton
                key={answer}
                chosen={draft.answer === answer}
                onClick={() => set({ answer })}
              >
                {answerWords[answer]}
              </ChoiceButton>
            ))}
          </ChoiceRow>
          {draft.answer === 'FILLED' ? (
            <>
              <ValueControl
                id={id}
                field={defined.field}
                draft={draft}
                set={set}
                refusals={shown}
              />
              <SourceStep id={id} draft={draft} set={set} refusals={shown} today={today} />
            </>
          ) : (
            <TextArea
              id={`${id}-note`}
              label="Reason"
              value={draft.note}
              onChange={(note) => set({ note })}
              limit={1000}
              error={noteError}
            />
          )}
          {formError ? <FieldError id={`${id}-form-error`}>{formError}</FieldError> : null}
        </>
      ) : null}
      <div className="route-dialog-actions">
        {step === 1 ? (
          <button type="button" className="primary-link" onClick={next}>
            {customDialogWords.next}
          </button>
        ) : (
          <>
            <button type="button" className="primary-link" onClick={add}>
              {customDialogWords.add}
            </button>
            <button type="button" className="text-link" onClick={back}>
              {customDialogWords.back}
            </button>
          </>
        )}
        <button type="button" className="text-link" onClick={onClose}>
          {customDialogWords.cancel}
        </button>
      </div>
    </div>
  );
}
