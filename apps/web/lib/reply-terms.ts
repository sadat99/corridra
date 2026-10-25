// The supplier Reply Page (ADR-069): what the form may send, and how a link names its language. Pure
// functions, no browser and no network. The database function accepts exactly eighteen quotation term
// keys; the form now offers every one of them. A blank term is "not stated" and is left out of the
// message, never sent as zero. A charge is zero only when the supplier says "no charge".
import { currencies } from '@corridra/domain/currencies';
import { originalAmountToMinor } from '@corridra/domain/locale';

export const incoterms = [
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
] as const;
export const shippingScopes = ['INCLUDED', 'EXCLUDED', 'NOT_SUPPLIED'] as const;

/** text: 3 to 1000 characters. integer: a whole number above zero. amount: a decimal in the original
 * currency. charge: "no charge" or an amount. date: a day, kept until the end of that day (UTC). */
export type ReplyKind =
  'text' | 'unit' | 'integer' | 'amount' | 'charge' | 'date' | 'incoterm' | 'shipping';
export type ReplyGroup = 'what' | 'price' | 'terms' | 'included';

export const replyFields = [
  { key: 'specification', kind: 'text', group: 'what' },
  { key: 'quantity', kind: 'integer', group: 'what' },
  { key: 'moq', kind: 'integer', group: 'what' },
  { key: 'unit', kind: 'unit', group: 'what' },
  { key: 'unitPriceMinor', kind: 'amount', group: 'price' },
  { key: 'totalPriceMinor', kind: 'amount', group: 'price' },
  { key: 'toolingMinor', kind: 'charge', group: 'price' },
  { key: 'setupMinor', kind: 'charge', group: 'price' },
  { key: 'packagingMinor', kind: 'charge', group: 'price' },
  { key: 'leadTime', kind: 'text', group: 'terms' },
  { key: 'validUntil', kind: 'date', group: 'terms' },
  { key: 'incoterm', kind: 'incoterm', group: 'terms' },
  { key: 'paymentTerms', kind: 'text', group: 'terms' },
  { key: 'shipping', kind: 'shipping', group: 'included' },
  { key: 'warranty', kind: 'text', group: 'included' },
  { key: 'installation', kind: 'text', group: 'included' },
  { key: 'training', kind: 'text', group: 'included' },
  { key: 'spares', kind: 'text', group: 'included' },
] as const satisfies readonly { key: string; kind: ReplyKind; group: ReplyGroup }[];

export type ReplyTermKey = (typeof replyFields)[number]['key'];
export const replyTermKeys: readonly ReplyTermKey[] = replyFields.map((field) => field.key);
export const replyGroups: readonly ReplyGroup[] = ['what', 'price', 'terms', 'included'];

/** The value the form holds for a charge when the supplier says there is none. */
export const noCharge = 'NONE';

export type ReplyError =
  | 'text'
  | 'unit'
  | 'integer'
  | 'amount'
  | 'places'
  | 'range'
  | 'date'
  | 'incoterm'
  | 'shipping'
  | 'currency';

export type ReplyBuild =
  | { ok: true; terms: Record<string, string> }
  | { ok: false; errors: Partial<Record<ReplyTermKey | 'currency', ReplyError>> };

const day = /^(\d{4})-(\d{2})-(\d{2})$/;
function endOfDay(value: string) {
  const match = day.exec(value);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  )
    return null;
  return `${value}T23:59:59Z`;
}

function amountError(message: string): ReplyError {
  if (message.includes('decimal places')) return 'places';
  if (message.includes('range')) return 'range';
  return 'amount';
}

/**
 * Turns what the supplier typed into the terms the database function accepts. `values` holds the raw
 * text per key; an absent or blank value is not stated and is left out. Only the keys in `only` are
 * checked when given (a step of the form); every key is checked when it is not.
 */
export function buildReplyTerms(
  values: Partial<Record<string, string>>,
  currency: string,
  only?: readonly ReplyTermKey[],
): ReplyBuild {
  const terms: Record<string, string> = {};
  const errors: Partial<Record<ReplyTermKey | 'currency', ReplyError>> = {};
  const needsCurrency = replyFields.some(
    (field) =>
      (only ? only.includes(field.key) : true) &&
      (field.kind === 'amount' || field.kind === 'charge') &&
      (values[field.key] ?? '').trim() !== '' &&
      (values[field.key] ?? '').trim() !== noCharge,
  );
  if (needsCurrency && !Object.hasOwn(currencies, currency)) errors.currency = 'currency';
  for (const field of replyFields) {
    if (only && !only.includes(field.key)) continue;
    const raw = (values[field.key] ?? '').trim();
    if (raw === '') continue;
    switch (field.kind) {
      case 'text':
        if (raw.length < 3 || raw.length > 1000) errors[field.key] = 'text';
        else terms[field.key] = raw;
        break;
      case 'unit':
        if (raw.length < 1 || raw.length > 80) errors[field.key] = 'unit';
        else terms[field.key] = raw;
        break;
      case 'integer':
        if (!/^[1-9][0-9]{0,11}$/.test(raw)) errors[field.key] = 'integer';
        else terms[field.key] = raw;
        break;
      case 'charge':
        if (raw === noCharge) {
          terms[field.key] = '0';
          break;
        }
      // falls through: a charge that is not "no charge" is an amount
      case 'amount':
        if (!Object.hasOwn(currencies, currency)) break;
        try {
          terms[field.key] = originalAmountToMinor(raw, currency);
        } catch (error) {
          errors[field.key] = amountError(error instanceof Error ? error.message : '');
        }
        break;
      case 'date': {
        const value = endOfDay(raw);
        if (!value) errors[field.key] = 'date';
        else terms[field.key] = value;
        break;
      }
      case 'incoterm':
        if (!(incoterms as readonly string[]).includes(raw)) errors[field.key] = 'incoterm';
        else terms[field.key] = raw;
        break;
      case 'shipping':
        if (!(shippingScopes as readonly string[]).includes(raw)) errors[field.key] = 'shipping';
        else terms[field.key] = raw;
        break;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, terms };
}

export type ReplyLanguage = 'en' | 'zh';
export const replyLanguages: readonly ReplyLanguage[] = ['en', 'zh'];

export type ReplyFragment = { token: string; language: ReplyLanguage; ask: ReplyTermKey[] };
const hex = /^[a-f0-9]{64}$/;

/**
 * Reads the part of the address after the hash. An older link is the bare token and means English with
 * nothing asked. A link from the Reply Page is `t=<token>&l=en|zh&ask=<term>,<term>`. The language is a
 * fixed list of two and the terms asked for are a fixed list of eighteen, so no other value can reach
 * the page. Nothing here is stored.
 */
export function parseReplyFragment(fragment: string): ReplyFragment {
  const none: ReplyFragment = { token: '', language: 'en', ask: [] };
  if (hex.test(fragment)) return { token: fragment, language: 'en', ask: [] };
  if (fragment.length > 600 || !fragment.includes('=')) return none;
  const params = new URLSearchParams(fragment);
  const token = params.get('t') ?? '';
  if (!hex.test(token)) return none;
  const language = (replyLanguages as readonly string[]).includes(params.get('l') ?? '')
    ? (params.get('l') as ReplyLanguage)
    : 'en';
  const ask = [
    ...new Set(
      (params.get('ask') ?? '')
        .split(',')
        .filter((key): key is ReplyTermKey => (replyTermKeys as readonly string[]).includes(key)),
    ),
  ];
  return { token, language, ask };
}

/** The address text the team adds to a recipient's link: the language and the terms asked for. */
export function replyLinkSuffix(language: ReplyLanguage, ask: readonly ReplyTermKey[]) {
  const params = new URLSearchParams();
  if (language !== 'en') params.set('l', language);
  const keys = [...new Set(ask)].filter((key) =>
    (replyTermKeys as readonly string[]).includes(key),
  );
  if (keys.length > 0) params.set('ask', keys.join(','));
  const text = params.toString();
  return text ? `&${text.replace(/%2C/g, ',')}` : '';
}
