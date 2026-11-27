'use client';
import { useEffect, useId, useMemo, useRef } from 'react';
import { FieldError } from '../../components/field-error';
import { ChoiceButton, ChoiceRow } from '../../components/ux/choice-chip';
import { MoneyInput } from '../../components/ux/money-input';
import { NumberField } from '../../components/ux/number-field';
import {
  controlFor,
  refusalWords,
  type FactDraft,
  type FormField,
  type Refusal,
} from '../../lib/route-pack-editor-fact-form';
import { currencyOptions, toMinor } from '../../lib/ux/money';
import { formatUtcDay } from '../../lib/ux/format';

// ADR-093 Phase 3, PR 2b: the value controls of one field row, by type (spec 8.8). Each is controlled: it shows the draft and
// reports a change, and holds no rule of its own beyond what it draws. A refusal comes in as words and is drawn under its
// control with aria-invalid and aria-describedby, so focus on the first invalid control reads it. Values and inputs carry
// dir="auto" because a place or a company may be named in any script. No inline style: every size comes from the stylesheet.

export type Change = (change: Partial<FactDraft>) => void;
type Common = { id: string; draft: FactDraft; set: Change; refusals: Refusal[] };
const errorOf = (refusals: Refusal[], part: Refusal['field'], index?: number) =>
  refusals.find(
    (refusal) => refusal.field === part && (index === undefined || refusal.index === index),
  )?.message ?? null;
const describe = (...ids: (string | null)[]) => ids.filter(Boolean).join(' ') || undefined;

/** A textarea with its counter ("412 of 1000"). The counter is not live; the over-limit words are an alert. */
export function TextArea({
  id,
  label,
  value,
  onChange,
  limit,
  error,
  rows = 4,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  limit: number;
  error: string | null;
  rows?: number;
}) {
  return (
    <div className="field route-edit-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        dir="auto"
        rows={rows}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe(`${id}-count`, error ? `${id}-error` : null)}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="route-edit-count" id={`${id}-count`}>
        {value.length} of {limit}
      </p>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

/** A native date input in the field styling. The day in words (the viewer's) stands under it once it is a real day. */
export function FactDateField({
  id,
  label,
  value,
  onChange,
  max,
  error,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  max?: string;
  error: string | null;
  hint?: string | null;
}) {
  const real = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return (
    <div className="field route-edit-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="date"
        value={value}
        max={max}
        aria-invalid={error ? true : undefined}
        aria-describedby={describe(
          real ? `${id}-words` : null,
          hint ? `${id}-hint` : null,
          error ? `${id}-error` : null,
        )}
        onChange={(event) => onChange(event.target.value)}
      />
      {real ? (
        <p className="route-edit-quiet" id={`${id}-words`}>
          {formatUtcDay(value)}
        </p>
      ) : null}
      {hint ? (
        <p className="route-edit-quiet" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  options,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  error: string | null;
}) {
  return (
    <div className="field route-edit-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        dir="auto"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

function ChoiceControl({
  id,
  label,
  field,
  draft,
  set,
  refusals,
}: Common & { label: string; field: FormField }) {
  const control = controlFor(field);
  const error = errorOf(refusals, 'text');
  const allowed = [...(field.allowed ?? [])];
  if (control.choiceStyle === 'select')
    return (
      <Select
        id={id}
        label={label}
        value={draft.text}
        options={[
          { value: '', label: 'Choose one' },
          ...allowed.map((value) => ({ value, label: value })),
        ]}
        onChange={(text) => set({ text })}
        error={error}
      />
    );
  return (
    <div className="route-edit-choice">
      <p className="route-edit-question" id={`${id}-q`}>
        {label}
      </p>
      <ChoiceRow labelledBy={`${id}-q`}>
        {allowed.map((value) => (
          <ChoiceButton
            key={value}
            chosen={draft.text === value}
            onClick={() => set({ text: value })}
          >
            {value}
          </ChoiceButton>
        ))}
      </ChoiceRow>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

function MoneyControl({ id, draft, set, refusals }: Common) {
  const options = useMemo(() => {
    const list = currencyOptions();
    return draft.currency && !list.some((option) => option.value === draft.currency)
      ? [...list, { value: draft.currency, label: draft.currency }]
      : list;
  }, [draft.currency]);
  let minor: string | null = null;
  try {
    minor = draft.amount.trim() ? toMinor(draft.amount, draft.currency || 'USD') : null;
  } catch {
    minor = null;
  }
  return (
    <div className="route-edit-money">
      <Select
        id={`${id}-currency`}
        label="Currency"
        value={draft.currency}
        options={[{ value: '', label: 'Choose a currency' }, ...options]}
        onChange={(currency) => set({ currency })}
        error={errorOf(refusals, 'currency')}
      />
      <MoneyInput
        id={`${id}-amount`}
        label="Amount"
        currency={draft.currency || 'USD'}
        value={minor}
        onChange={() => undefined}
        onText={(amount) => set({ amount })}
        decimalsWords={(places, code) =>
          places === 0 ? refusalWords.wholeAmount(code) : refusalWords.decimals(places, code)
        }
        error={errorOf(refusals, 'amount') ?? undefined}
        disabled={!draft.currency}
      />
    </div>
  );
}

function ListControl({
  id,
  label,
  field,
  draft,
  set,
  refusals,
}: Common & { label: string; field: FormField }) {
  const control = controlFor(field);
  const entries = useRef<(HTMLInputElement | null)[]>([]);
  const add = useRef<HTMLButtonElement>(null);
  // After an entry is added or removed, focus goes where the spec says: the new entry, the one before, or Add Another.
  const focusAfter = useRef<number | 'add' | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'add') add.current?.focus();
    else if (target !== null) entries.current[target]?.focus();
  });
  const max = field.maxItems ?? 100;
  if (control.boxes) {
    const chosen = draft.items.filter(Boolean);
    const error = errorOf(refusals, 'items');
    return (
      <fieldset className="route-edit-boxes" aria-describedby={error ? `${id}-error` : undefined}>
        <legend>{label}</legend>
        {(field.allowed ?? []).map((value) => (
          <label key={value} className="ux-check route-edit-check" dir="auto">
            <input
              type="checkbox"
              checked={chosen.includes(value)}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...chosen, value]
                  : chosen.filter((item) => item !== value);
                set({ items: (field.allowed ?? []).filter((item) => next.includes(item)) });
              }}
            />
            <span>{value}</span>
          </label>
        ))}
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </fieldset>
    );
  }
  const items = draft.items.length ? draft.items : [''];
  const full = items.length >= max;
  return (
    <fieldset className="route-edit-list">
      <legend>{label}</legend>
      {items.map((item, index) => {
        const error = errorOf(refusals, 'items', index);
        const general =
          index === 0 && refusals.some((r) => r.field === 'items' && r.index === undefined);
        return (
          <div className="route-edit-entry" key={index}>
            <div className="field route-edit-field">
              <label htmlFor={`${id}-entry-${index}`}>Entry {index + 1}</label>
              <input
                id={`${id}-entry-${index}`}
                ref={(element) => {
                  entries.current[index] = element;
                }}
                dir="auto"
                value={item}
                aria-invalid={error || general ? true : undefined}
                aria-describedby={
                  error ? `${id}-entry-${index}-error` : general ? `${id}-error` : undefined
                }
                onChange={(event) =>
                  set({
                    items: items.map((value, at) => (at === index ? event.target.value : value)),
                  })
                }
              />
              {error ? <FieldError id={`${id}-entry-${index}-error`}>{error}</FieldError> : null}
            </div>
            {items.length > 1 ? (
              <button
                type="button"
                className="text-link"
                aria-label={`Remove entry ${index + 1}`}
                onClick={() => {
                  focusAfter.current = index > 0 ? index - 1 : 'add';
                  set({ items: items.filter((_, at) => at !== index) });
                }}
              >
                Remove
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        ref={add}
        type="button"
        className="text-link"
        disabled={full}
        aria-describedby={full ? `${id}-max` : undefined}
        onClick={() => {
          focusAfter.current = items.length;
          set({ items: [...items, ''] });
        }}
      >
        Add Another
      </button>
      {refusals.find((r) => r.field === 'items' && r.index === undefined) ? (
        <FieldError id={`${id}-error`}>
          {refusals.find((r) => r.field === 'items' && r.index === undefined)!.message}
        </FieldError>
      ) : null}
      {full ? (
        <p className="route-edit-quiet" id={`${id}-max`}>
          You can add up to {max} entries.
        </p>
      ) : null}
    </fieldset>
  );
}

/** The control of one field, by its type. `id` is a stable prefix for every id the control draws. */
export function ValueControl({ id, field, draft, set, refusals }: Common & { field: FormField }) {
  const label = field.label ?? field.key;
  const control = controlFor(field);
  const textError = errorOf(refusals, 'text');
  switch (field.type) {
    case 'text':
      return (
        <TextArea
          id={`${id}-text`}
          label={label}
          value={draft.text}
          onChange={(text) => set({ text })}
          limit={field.maxLength}
          error={textError}
        />
      );
    case 'number':
      return (
        <NumberField
          id={`${id}-text`}
          label={label}
          value={draft.text}
          whole={control.whole}
          min={control.numberMin}
          onChange={(text) => set({ text })}
          error={textError}
        />
      );
    case 'money':
      return <MoneyControl id={id} draft={draft} set={set} refusals={refusals} />;
    case 'date':
      return (
        <FactDateField
          id={`${id}-text`}
          label={label}
          value={draft.text}
          onChange={(text) => set({ text })}
          error={textError}
        />
      );
    case 'choice':
      return (
        <ChoiceControl
          id={`${id}-text`}
          label={label}
          field={field}
          draft={draft}
          set={set}
          refusals={refusals}
        />
      );
    case 'list':
      return (
        <ListControl
          id={id}
          label={label}
          field={field}
          draft={draft}
          set={set}
          refusals={refusals}
        />
      );
    case 'link':
      return (
        <div className="field route-edit-field">
          <label htmlFor={`${id}-text`}>{label}</label>
          <input
            id={`${id}-text`}
            dir="auto"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={draft.text}
            aria-invalid={textError ? true : undefined}
            aria-describedby={textError ? `${id}-text-error` : undefined}
            onChange={(event) => set({ text: event.target.value })}
          />
          {textError ? <FieldError id={`${id}-text-error`}>{textError}</FieldError> : null}
        </div>
      );
  }
}

/** The second step: where the fact came from, and when it was seen and until when it holds. */
export function SourceStep({ id, draft, set, refusals, today }: Common & { today: string }) {
  const heading = useId();
  const addressError = errorOf(refusals, 'address');
  const passed = draft.validUntil && draft.validUntil < today;
  return (
    <div className="route-edit-source">
      <p className="route-edit-question" id={heading}>
        Source
      </p>
      <ChoiceRow labelledBy={heading}>
        <ChoiceButton chosen={draft.source === 'staff'} onClick={() => set({ source: 'staff' })}>
          Staff knowledge
        </ChoiceButton>
        <ChoiceButton chosen={draft.source === 'web'} onClick={() => set({ source: 'web' })}>
          A web address
        </ChoiceButton>
      </ChoiceRow>
      {draft.source === 'web' ? (
        <div className="field route-edit-field">
          <label htmlFor={`${id}-address`}>Web address</label>
          <input
            id={`${id}-address`}
            dir="auto"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={draft.address}
            aria-invalid={addressError ? true : undefined}
            aria-describedby={addressError ? `${id}-address-error` : undefined}
            onChange={(event) => set({ address: event.target.value })}
          />
          {addressError ? <FieldError id={`${id}-address-error`}>{addressError}</FieldError> : null}
        </div>
      ) : null}
      <fieldset className="route-edit-dates">
        <legend>Dates</legend>
        <FactDateField
          id={`${id}-observed`}
          label="Observed on"
          value={draft.observedOn}
          max={today}
          onChange={(observedOn) => set({ observedOn })}
          error={errorOf(refusals, 'observedOn')}
        />
        <FactDateField
          id={`${id}-until`}
          label="Valid until (optional)"
          value={draft.validUntil}
          onChange={(validUntil) => set({ validUntil })}
          error={errorOf(refusals, 'validUntil')}
          hint={passed ? 'This date has passed, so the fact stays Stale.' : null}
        />
      </fieldset>
    </div>
  );
}
