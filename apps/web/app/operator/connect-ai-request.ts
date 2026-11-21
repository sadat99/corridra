// ADR-089. The guided Connect AI screen's draft, its checks and the one request it sends. Pure, so a test can prove the
// request parses under the server's guidedConnection schema. Money stays text: a typed USD amount becomes an exact
// minor-unit string by moving the decimal point in the text, never through a floating point number. The server stays the
// authority for every rule; these checks only put an error beside its field before a request is made.
import { taskIds, type TaskId } from '@corridra/intelligence/registry';
import { words, type AdapterChoice } from './connect-ai-copy';

export type EvaluationStatus = 'SYNTHETIC_ONLY' | 'APPROVED_PROVIDER';

export type ConnectDraft = {
  adapter: AdapterChoice | '';
  model: string;
  evaluationStatus: EvaluationStatus | '';
  scope: 'countries' | 'market';
  codes: string[];
  termsSourceId: string;
  evaluationSourceId: string;
  /** USD amounts as typed, such as "12.50". */
  inputRate: string;
  outputRate: string;
  maxCost: string;
  dailyBudget: string;
  /** A date as YYYY-MM-DD, read as the end of that day in UTC. */
  validUntil: string;
  tasks: TaskId[];
  fallbackPolicyId: string;
  reason: string;
  confirmed: boolean;
};

export const emptyDraft: ConnectDraft = {
  adapter: '',
  model: '',
  evaluationStatus: '',
  scope: 'countries',
  codes: [],
  termsSourceId: '',
  evaluationSourceId: '',
  inputRate: '',
  outputRate: '',
  maxCost: '',
  dailyBudget: '',
  validUntil: '',
  tasks: [],
  fallbackPolicyId: '',
  reason: '',
  confirmed: false,
};

// 1,000.00 USD, as the server's guidedConnection allows. Compared as text: a minor string has no leading zero.
const maxDailyBudgetMinor = '100000';
const atMost = (minor: string, cap: string) =>
  minor.length < cap.length || (minor.length === cap.length && minor <= cap);
const minorPattern = /^[1-9][0-9]{0,12}$/;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

/** A typed USD amount as an exact minor-unit string, or the words that say what to fix. */
export function usdToMinor(typed: string): { minor: string } | { error: string } {
  const text = typed.trim();
  if (/^-/.test(text)) return { error: words.money.aboveZero };
  const match = /^([0-9]*)(?:\.([0-9]*))?$/.exec(text);
  if (!text || !match || (match[1] === '' && !match[2])) return { error: words.money.notNumber };
  const fraction = match[2] ?? '';
  if (fraction.length > 2) return { error: words.money.decimals };
  const minor = `${match[1]}${fraction.padEnd(2, '0')}`.replace(/^0+/, '');
  if (!minor) return { error: words.money.aboveZero };
  if (!minorPattern.test(minor)) return { error: words.money.notNumber };
  return { minor };
}

/** An exact minor-unit string as USD text with two decimals, for prefilling from an earlier version. */
export function minorToUsd(minor: string): string {
  if (!/^[0-9]+$/.test(minor)) return '';
  const padded = minor.padStart(3, '0');
  return `${padded.slice(0, -2).replace(/^0+(?=[0-9])/, '')}.${padded.slice(-2)}`;
}

function modelError(model: string): string | null {
  if (!model.trim()) return words.model.blank;
  if (!modelPattern.test(model) || model.split('/').some((s) => s === '.' || s === '..'))
    return words.model.invalid;
  return null;
}

const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);

function validUntilError(date: string, now = new Date()): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date > todayUtc(now) ? null : words.limits.validError;
}

export type FieldErrors = Partial<Record<FieldName, string>>;
export type FieldName =
  | 'adapter'
  | 'model'
  | 'evaluationStatus'
  | 'codes'
  | 'termsSourceId'
  | 'evaluationSourceId'
  | 'inputRate'
  | 'outputRate'
  | 'maxCost'
  | 'dailyBudget'
  | 'validUntil'
  | 'tasks'
  | 'fallbackPolicyId'
  | 'reason'
  | 'confirmed';

/** The fields each step asks for, in screen order. Review asks for nothing. */
export const stepFields: readonly (readonly FieldName[])[] = [
  ['adapter'],
  ['model', 'evaluationStatus'],
  ['codes'],
  ['termsSourceId', 'evaluationSourceId'],
  ['inputRate', 'outputRate', 'maxCost'],
  ['dailyBudget', 'validUntil'],
  ['tasks', 'fallbackPolicyId'],
  [],
  ['reason', 'confirmed'],
];

export function fieldError(draft: ConnectDraft, field: FieldName, now = new Date()) {
  switch (field) {
    case 'adapter':
      return draft.adapter ? null : words.provider.error;
    case 'model':
      return modelError(draft.model);
    case 'evaluationStatus':
      return draft.evaluationStatus ? null : words.evaluation.error;
    case 'codes':
      return draft.scope === 'market' || draft.codes.length ? null : words.countries.none;
    case 'termsSourceId':
    case 'evaluationSourceId':
      return draft[field] ? null : words.sources.blank;
    case 'inputRate':
    case 'outputRate':
    case 'maxCost': {
      const money = usdToMinor(draft[field]);
      return 'error' in money ? money.error : null;
    }
    case 'dailyBudget': {
      const money = usdToMinor(draft.dailyBudget);
      if ('error' in money) return money.error;
      return atMost(money.minor, maxDailyBudgetMinor) ? null : words.limits.budgetOver;
    }
    case 'validUntil':
      return validUntilError(draft.validUntil, now);
    case 'tasks':
      return draft.tasks.length ? null : words.tasks.error;
    case 'fallbackPolicyId':
      return null;
    case 'reason':
      return draft.reason.trim().length >= 3 ? null : words.save.reasonError;
    case 'confirmed':
      return draft.confirmed ? null : words.save.confirmError;
  }
}

export function stepErrors(draft: ConnectDraft, step: number, now = new Date()): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of stepFields[step] ?? []) {
    const error = fieldError(draft, field, now);
    if (error) errors[field] = error;
  }
  return errors;
}

const minorOf = (typed: string) => {
  const money = usdToMinor(typed);
  if ('error' in money) throw new Error(money.error);
  return money.minor;
};

/**
 * The one request body the screen sends: plain answers only. No key, no key name, no processing location for a market
 * (the server resolves "EU"), no version number to write (only the version the person saw) and an explicit confirmation.
 * Throws when a step's check would fail, so nothing is sent from an incomplete draft.
 */
export function buildConnectionRequest(
  draft: ConnectDraft,
  expectedVersion: number,
  now = new Date(),
) {
  for (const fields of stepFields)
    for (const field of fields) {
      const error = fieldError(draft, field, now);
      if (error) throw new Error(error);
    }
  if (!draft.adapter || !draft.evaluationStatus) throw new Error(words.provider.error);
  return {
    adapter: draft.adapter,
    model: draft.model,
    evaluationStatus: draft.evaluationStatus,
    processingScope:
      draft.scope === 'market'
        ? ({ kind: 'market', key: 'EU' } as const)
        : ({ kind: 'countries', codes: [...draft.codes] } as const),
    termsSourceId: draft.termsSourceId,
    evaluationSourceId: draft.evaluationSourceId,
    inputRateMinorPerMillion: minorOf(draft.inputRate),
    outputRateMinorPerMillion: minorOf(draft.outputRate),
    maxCostMinor: minorOf(draft.maxCost),
    dailyBudgetMinor: minorOf(draft.dailyBudget),
    effectiveUntil: `${draft.validUntil}T23:59:59Z`,
    tasks: taskIds.filter((task) => draft.tasks.includes(task)),
    ...(draft.fallbackPolicyId ? { fallbackPolicyId: draft.fallbackPolicyId } : {}),
    reason: draft.reason.trim(),
    expectedVersion,
    confirmed: true as const,
  };
}
