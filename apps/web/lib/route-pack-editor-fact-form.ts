import { currencies } from '@corridra/domain/currencies';
import {
  contentDocumentIssues,
  factTypes,
  routePackSections,
  routePackWords,
  standardFieldByKey,
  type ContentFact,
  type FactType,
  type SectionNumber,
  type StandardField,
} from '@corridra/domain/route-pack-standard';
import { hasContactShape } from '@corridra/domain/supply-sources';

// ADR-093 Phase 3, PR 2a: the answer of one field row, as a draft the editor holds while a person types, and the pure step from
// that draft to a ContentFact (spec 8.8). The words of the refusals are the spec's. The server stays the authority: after these
// checks the fact is run through the document rules of the domain, so a fact this file returns always passes
// parseContentDocument, and a rule that is not worded here falls back to the domain's own message.

/** What the row can be set to. REMOVE is the third answer of a custom row, "Remove Field". */
export type FactAnswer = 'FILLED' | 'NOT_APPLICABLE' | 'PENDING' | 'REMOVE';
export const answerWords: Record<FactAnswer, string> = {
  FILLED: 'Filled',
  NOT_APPLICABLE: 'Not applicable',
  PENDING: 'Pending',
  REMOVE: 'Remove Field',
};
export const refusalWords = {
  email:
    'This looks like an email address. Route facts name organisations, places and rules, never people. Remove it.',
  source: 'Give a web address that starts with https://, or choose Staff knowledge.',
  notApplicable: 'Say why this does not apply to this route.',
  limit: (count: number, limit: number) =>
    `That is ${count.toLocaleString('en-US')} characters. The limit is ${limit}. Shorten it.`,
  // ADR-093 Phase 3, PR 2b: the words of the editor's controls (designer copy, spec 8.8).
  number: 'Use a number such as 12 or 12.5, with at most 5 decimals.',
  wholeNumber: 'Use a whole number.',
  decimals: (places: number, code: string) => `Use at most ${places} decimals for ${code}.`,
  wholeAmount: (code: string) => `Use a whole amount for ${code}.`,
  pickDate: 'Pick a date.',
  atLeast: (min: number) => `Write at least ${min} ${min === 1 ? 'character' : 'characters'}.`,
  /** One entry of a list that is not in the form of the field; `format` is the field's own words from the standard. */
  entry: (index: number, format?: string) =>
    `Check entry ${index + 1}.${format?.trim() ? ` ${format.trim().replace(/[.\s]+$/, '')}.` : ''}`,
  bar: 'Do not use the | sign in an entry. The route file uses it to separate values.',
  link: 'Give a web address that starts with https://.',
  observedFuture: 'The observed date cannot be in the future.',
  validBefore: 'Valid until must be on or after the observed date.',
} as const;
/** The help of a row that cannot be set to Pending because its section is marked Not applicable. */
export const coveredHelp =
  'This section is marked Not applicable. Unmark the section to make this field Pending.';
/** The help of a Locked Core row, which never offers Not applicable. */
export const lockedCoreHelp = 'An empty list is not the same as does not apply.';

/** The part of a field this file needs: a standard row, or a custom fact's own definition. */
export type FormField = Pick<StandardField, 'key' | 'type' | 'maxLength'> &
  Partial<
    Pick<StandardField, 'label' | 'minLength' | 'maxItems' | 'allowed' | 'itemPattern' | 'format'>
  > & {
    part: 'Locked' | 'Content';
    core: boolean;
    custom: boolean;
    /** Custom fields only: the definition kept in the fact. */
    definition?: CustomDefinition;
  };
export type CustomDefinition = {
  label: string;
  section: SectionNumber;
  type: FactType;
  allowedValues?: string[];
};
export function standardField(key: string): FormField | null {
  const field = standardFieldByKey.get(key);
  return field ? { ...field, custom: false } : null;
}
export function customField(key: string, definition: CustomDefinition): FormField {
  return {
    key,
    label: definition.label,
    type: definition.type,
    part: 'Content',
    core: false,
    custom: true,
    maxLength: 1000,
    maxItems: 100,
    allowed: definition.allowedValues,
    definition,
  };
}
/** The field of a custom fact in the saved document, or null when it carries no definition. */
export function fieldOfCustomFact(fact: ContentFact): FormField | null {
  if (!fact.key.startsWith('custom.') || !fact.label || !fact.section || !fact.type) return null;
  return customField(fact.key, {
    label: fact.label,
    section: fact.section,
    type: fact.type,
    ...(fact.allowedValues ? { allowedValues: fact.allowedValues } : {}),
  });
}

export type FactDraft = {
  answer: FactAnswer;
  /** text, number, date, choice and link. */
  text: string;
  /** list. */
  items: string[];
  /** money: the currency code and the amount as typed ("45.00"). */
  currency: string;
  amount: string;
  /** The reason of Not applicable. */
  note: string;
  /** A note a Filled fact already carries (saved by an import); kept as it is. */
  filledNote: string;
  source: 'staff' | 'web';
  address: string;
  observedOn: string;
  validUntil: string;
};
export type DraftPart = keyof FactDraft | 'form';
/** `index` is set for one entry of a list (counted from 0), so the page can focus that entry. */
export type Refusal = { field: DraftPart; message: string; index?: number };
export type FactBuilt = { ok: true; fact: ContentFact | null } | { ok: false; refusals: Refusal[] };

const staffKnowledge = 'staff knowledge';
export const emptyDraft = (today: string): FactDraft => ({
  answer: 'FILLED',
  text: '',
  items: [''],
  currency: '',
  amount: '',
  note: '',
  filledNote: '',
  source: 'staff',
  address: '',
  observedOn: today,
  validUntil: '',
});
// The amount of a money value as a person types it: whole units, a point and the currency's own decimals.
function amountText(amountMinor: string, code: string) {
  const decimals = (currencies as Record<string, number>)[code] ?? 2;
  if (decimals === 0) return amountMinor;
  const padded = amountMinor.padStart(decimals + 1, '0');
  return `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}
/** The draft of a row: its fact, or Pending when there is none (a custom row with no fact is Filled, as it is being made). */
export function draftFromFact(
  field: FormField,
  fact: ContentFact | null,
  today: string,
): FactDraft {
  const draft = emptyDraft(today);
  if (!fact) return { ...draft, answer: field.custom ? 'FILLED' : 'PENDING' };
  if (fact.state === 'NOT_APPLICABLE')
    return { ...draft, answer: 'NOT_APPLICABLE', note: fact.note ?? '' };
  const value = fact.value;
  return {
    ...draft,
    text: typeof value === 'string' ? value : '',
    items: Array.isArray(value) && value.length ? value : [''],
    ...(value && typeof value === 'object' && !Array.isArray(value)
      ? { currency: value.currency, amount: amountText(value.amountMinor, value.currency) }
      : {}),
    filledNote: fact.note ?? '',
    source: fact.source && fact.source !== staffKnowledge ? 'web' : 'staff',
    address: fact.source && fact.source !== staffKnowledge ? fact.source : '',
    observedOn: fact.observedOn ?? today,
    validUntil: fact.validUntil ?? '',
  };
}

/**
 * The answers a row offers, in order. A Locked row is read only in PR 2 (pack settings are PR 3) and offers none, so Not
 * applicable is never offered on a Locked Core row. Pending is not offered on a row covered by a section marked Not
 * applicable (`coveredHelp` says why). A custom row has no Pending: its third answer is Remove Field.
 */
export function answersFor(row: { field: FormField; coveredBySection?: boolean }): FactAnswer[] {
  const { field } = row;
  if (field.part === 'Locked') return [];
  if (field.custom) return ['FILLED', 'NOT_APPLICABLE', 'REMOVE'];
  return row.coveredBySection
    ? ['FILLED', 'NOT_APPLICABLE']
    : ['FILLED', 'NOT_APPLICABLE', 'PENDING'];
}

// ---- Custom fields -----------------------------------------------------------------------------------------------------

/** `custom.` and a short key made from the label, never one of `taken` (add _2, _3 and so on). */
export function customKeyFor(label: string, taken: Iterable<string> = []): string {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const start = /^[a-z]/.test(slug) ? slug : slug ? `f_${slug}` : 'field';
  const used = new Set(taken);
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `_${n}`;
    const key = `custom.${start.slice(0, 59 - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!used.has(key)) return key;
  }
}
/** The definition a custom fact carries, from what the first step of Add Custom Field collects. */
export function customDefinition(input: {
  label: string;
  section: number;
  type: string;
  allowedValues?: string[];
}): { ok: true; definition: CustomDefinition } | { ok: false; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const label = input.label.trim();
  if (!label) refusals.push({ field: 'text', message: 'Give the field a name.' });
  else if (label.length > 120)
    refusals.push({ field: 'text', message: refusalWords.limit(label.length, 120) });
  else if (hasContactShape(label, { phone: false }))
    refusals.push({ field: 'text', message: refusalWords.email });
  const section = routePackSections.find((item) => item.number === input.section);
  if (!section) refusals.push({ field: 'form', message: routePackWords.sectionName });
  const type = factTypes.find((item) => item === input.type);
  if (!type) refusals.push({ field: 'form', message: 'Choose the type of the answer.' });
  const allowed = [...new Set((input.allowedValues ?? []).map((value) => value.trim()))].filter(
    Boolean,
  );
  if (type === 'choice' && allowed.length === 0)
    refusals.push({ field: 'items', message: 'Give the answers a person may choose from.' });
  if (type !== 'choice' && type !== 'list' && allowed.length)
    refusals.push({ field: 'items', message: 'Only a choice or a list takes allowed values.' });
  if (allowed.length > 50)
    refusals.push({ field: 'items', message: 'Give at most 50 allowed values.' });
  const longest = allowed.reduce((most, value) => Math.max(most, value.length), 0);
  if (longest > 120) refusals.push({ field: 'items', message: refusalWords.limit(longest, 120) });
  if (allowed.some((value) => value.includes('|')))
    refusals.push({ field: 'items', message: 'An allowed value cannot contain the | sign.' });
  if (allowed.some((value) => hasContactShape(value, { phone: false })))
    refusals.push({ field: 'items', message: refusalWords.email });
  if (refusals.length || !section || !type) return { ok: false, refusals };
  return {
    ok: true,
    definition: {
      label,
      section: section.number,
      type,
      ...(allowed.length ? { allowedValues: allowed } : {}),
    },
  };
}

// ---- The step from a draft to a fact -------------------------------------------------------------------------------------

const canonicalNumber = /^-?(0|[1-9]\d{0,14})(\.\d{0,5}[1-9])?$/;
const isDate = (text: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
};
const isHttps = (text: string) => {
  if (!/^https:\/\/\S+$/.test(text)) return false;
  try {
    return new URL(text).protocol === 'https:';
  } catch {
    return false;
  }
};

type ValueResult = { value: ContentFact['value']; refusals: Refusal[] };
function valueFrom(field: FormField, draft: FactDraft): ValueResult {
  const refuse = (part: DraftPart, message: string): ValueResult => ({
    value: undefined,
    refusals: [{ field: part, message }],
  });
  const tooLong = (text: string, limit: number, part: DraftPart) =>
    text.length > limit ? refuse(part, refusalWords.limit(text.length, limit)) : null;
  switch (field.type) {
    case 'text': {
      const text = draft.text.trim();
      const min = Math.max(field.minLength ?? 1, 1);
      return (
        tooLong(text, field.maxLength, 'text') ??
        (text.length < min
          ? refuse('text', refusalWords.atLeast(min))
          : { value: text, refusals: [] })
      );
    }
    case 'number': {
      let text = draft.text.trim();
      // 12.50 is the number 12.5: trailing zeros after the point are not part of the stored form.
      if (/^-?\d+\.\d*$/.test(text)) text = text.replace(/0+$/, '').replace(/\.$/, '');
      const whole = field.itemPattern !== undefined;
      const fits =
        canonicalNumber.test(text) &&
        text !== '-0' &&
        (!field.itemPattern || field.itemPattern.test(text));
      return fits
        ? { value: text, refusals: [] }
        : refuse('text', whole ? refusalWords.wholeNumber : refusalWords.number);
    }
    case 'money': {
      const code = draft.currency.trim().toUpperCase();
      const decimals = (currencies as Record<string, number | undefined>)[code];
      if (decimals === undefined) return refuse('currency', 'Choose a currency.');
      const typed = draft.amount.trim();
      const match = /^(\d+)(?:\.(\d*))?$/.exec(typed);
      if (!match) return refuse('amount', 'Write the amount in numbers, such as 45.00.');
      const [, whole = '', fraction = ''] = match;
      if (fraction.length > decimals)
        return refuse(
          'amount',
          decimals === 0 ? refusalWords.wholeAmount(code) : refusalWords.decimals(decimals, code),
        );
      const minor = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+/, '');
      if (!minor) return refuse('amount', 'Enter an amount above zero.');
      if (minor.length > 18) return refuse('amount', 'That amount is too large.');
      return {
        value: { currency: code as keyof typeof currencies, amountMinor: minor },
        refusals: [],
      };
    }
    case 'date': {
      const text = draft.text.trim();
      return isDate(text) ? { value: text, refusals: [] } : refuse('text', refusalWords.pickDate);
    }
    case 'choice': {
      const text = draft.text.trim();
      return field.allowed?.includes(text)
        ? { value: text, refusals: [] }
        : refuse('text', 'Choose one of the answers.');
    }
    case 'list': {
      const typed = draft.items.map((item, index) => ({ item: item.trim(), index }));
      const entries = typed.filter(({ item }) => item);
      const limit = field.maxItems ?? 100;
      const refuseEntry = (index: number, message: string): ValueResult => ({
        value: undefined,
        refusals: [{ field: 'items', message, index }],
      });
      if (entries.length === 0) return refuse('items', 'Add at least one entry.');
      if (entries.length > limit) return refuse('items', `Add at most ${limit} entries.`);
      const long = entries.find(({ item }) => item.length > field.maxLength);
      if (long)
        return refuseEntry(long.index, refusalWords.limit(long.item.length, field.maxLength));
      const bar = entries.find(({ item }) => item.includes('|'));
      if (bar) return refuseEntry(bar.index, refusalWords.bar);
      const outside = field.allowed
        ? entries.find(({ item }) => !field.allowed!.includes(item))
        : undefined;
      if (outside)
        return refuseEntry(outside.index, refusalWords.entry(outside.index, field.format));
      const odd = field.itemPattern
        ? entries.find(({ item }) => !field.itemPattern!.test(item))
        : undefined;
      if (odd) return refuseEntry(odd.index, refusalWords.entry(odd.index, field.format));
      return { value: entries.map(({ item }) => item), refusals: [] };
    }
    case 'link': {
      const text = draft.text.trim();
      if (text.length > field.maxLength)
        return refuse('text', refusalWords.limit(text.length, field.maxLength));
      return isHttps(text) ? { value: text, refusals: [] } : refuse('text', refusalWords.link);
    }
  }
}

/**
 * The fact a draft stands for. Pending and Remove Field give `fact: null` (the fact leaves the document). Otherwise the
 * fact, or every refusal in the order of the form so the first can take focus. `today` is the day written YYYY-MM-DD.
 */
export function factFromDraft(field: FormField, draft: FactDraft, today: string): FactBuilt {
  if (draft.answer === 'PENDING' || draft.answer === 'REMOVE') return { ok: true, fact: null };
  if (field.part === 'Locked')
    return {
      ok: false,
      refusals: [{ field: 'form', message: routePackWords.lockedFilled(field.key) }],
    };
  const refusals: Refusal[] = [];
  const define: Pick<ContentFact, 'label' | 'section' | 'type' | 'allowedValues'> = field.definition
    ? {
        label: field.definition.label,
        section: field.definition.section,
        type: field.definition.type,
        ...(field.definition.allowedValues
          ? { allowedValues: field.definition.allowedValues }
          : {}),
      }
    : {};
  let fact: ContentFact;
  if (draft.answer === 'NOT_APPLICABLE') {
    const note = draft.note.trim();
    if (note.length < 3) refusals.push({ field: 'note', message: refusalWords.notApplicable });
    else if (note.length > 1000)
      refusals.push({ field: 'note', message: refusalWords.limit(note.length, 1000) });
    else if (hasContactShape(note, { phone: false }))
      refusals.push({ field: 'note', message: refusalWords.email });
    fact = { key: field.key, state: 'NOT_APPLICABLE', note, ...define };
  } else {
    const built = valueFrom(field, draft);
    refusals.push(...built.refusals);
    const texts = [
      ...(typeof built.value === 'string'
        ? [built.value]
        : Array.isArray(built.value)
          ? built.value
          : []),
      draft.filledNote,
    ];
    if (!built.refusals.length && texts.some((text) => hasContactShape(text, { phone: false })))
      refusals.push({
        field: field.type === 'list' ? 'items' : 'text',
        message: refusalWords.email,
      });
    let source: string | undefined;
    if (draft.source === 'staff') source = staffKnowledge;
    else {
      const address = draft.address.trim();
      if (hasContactShape(address, { phone: false }))
        refusals.push({ field: 'address', message: refusalWords.email });
      else if (!isHttps(address) || address.length > 1000)
        refusals.push({ field: 'address', message: refusalWords.source });
      else source = address;
    }
    const observedOn = draft.observedOn.trim();
    if (!isDate(observedOn))
      refusals.push({
        field: 'observedOn',
        message: refusalWords.pickDate,
      });
    else if (observedOn > today)
      refusals.push({ field: 'observedOn', message: refusalWords.observedFuture });
    const validUntil = draft.validUntil.trim();
    if (validUntil && !isDate(validUntil))
      refusals.push({ field: 'validUntil', message: refusalWords.pickDate });
    else if (validUntil && isDate(observedOn) && validUntil < observedOn)
      refusals.push({
        field: 'validUntil',
        message: refusalWords.validBefore,
      });
    const filledNote = draft.filledNote.trim();
    fact = {
      key: field.key,
      state: 'FILLED',
      ...(built.value !== undefined ? { value: built.value } : {}),
      ...(source ? { source } : {}),
      ...(isDate(observedOn) ? { observedOn } : {}),
      ...(validUntil && isDate(validUntil) ? { validUntil } : {}),
      ...(filledNote ? { note: filledNote } : {}),
      ...define,
    };
  }
  if (refusals.length) return { ok: false, refusals };
  // The server's own rules, for anything not worded above. Judged on the fact alone, so one issue is about this fact.
  const issues = contentDocumentIssues({ standardVersion: 1, sectionMarks: [], facts: [fact] });
  if (issues.length)
    return { ok: false, refusals: [{ field: 'form', message: issues[0]!.message }] };
  return { ok: true, fact };
}

// ---- What the editor draws for a field (PR 2b) -------------------------------------------------------------------------

export type ValueControl = {
  kind: FactType;
  /** The `min` of a number control: 0 only for a field whose items must match a whole-day pattern; none for any other number. */
  numberMin: 0 | null;
  /** Whole numbers only (the control steps by 1). */
  whole: boolean;
  /** A choice: answer rows up to 4 values, a labelled select from 5. Null for any other type. */
  choiceStyle: 'row' | 'select' | null;
  /** A list that has allowed values: check boxes instead of typed entries. */
  boxes: boolean;
};
/**
 * The control a field gets. The standard has one number field, "Days to get a visa" (`travel.visa_lead_time_days`), whose
 * item pattern is whole days from 0, so only it has a minimum of 0; a custom number field has no pattern and no minimum,
 * because the standard allows a minus sign and decimals there.
 */
export function controlFor(
  field: Pick<FormField, 'type' | 'itemPattern' | 'allowed'>,
): ValueControl {
  const whole = field.type === 'number' && field.itemPattern !== undefined;
  return {
    kind: field.type,
    numberMin: whole ? 0 : null,
    whole,
    choiceStyle:
      field.type === 'choice' ? ((field.allowed?.length ?? 0) >= 5 ? 'select' : 'row') : null,
    boxes: field.type === 'list' && (field.allowed?.length ?? 0) > 0,
  };
}
/**
 * The refusals that show as a person types: a text or a note over its limit, and money with more decimals than its currency
 * has. Every other refusal waits for "Next" or "Keep Change" (`factFromDraft`). Empty when the draft is not Filled or Not
 * applicable.
 */
export function liveIssues(field: FormField, draft: FactDraft): Refusal[] {
  const refusals: Refusal[] = [];
  if (draft.answer === 'NOT_APPLICABLE') {
    const length = draft.note.trim().length;
    if (length > 1000) refusals.push({ field: 'note', message: refusalWords.limit(length, 1000) });
    return refusals;
  }
  if (draft.answer !== 'FILLED') return refusals;
  if (field.type === 'text') {
    const length = draft.text.trim().length;
    if (length > field.maxLength)
      refusals.push({ field: 'text', message: refusalWords.limit(length, field.maxLength) });
  }
  if (field.type === 'money') {
    const code = draft.currency.trim().toUpperCase();
    const decimals = (currencies as Record<string, number | undefined>)[code];
    const match = /^(\d+)(?:\.(\d*))?$/.exec(draft.amount.trim());
    if (decimals !== undefined && match && (match[2] ?? '').length > decimals)
      refusals.push({
        field: 'amount',
        message:
          decimals === 0 ? refusalWords.wholeAmount(code) : refusalWords.decimals(decimals, code),
      });
  }
  return refusals;
}
