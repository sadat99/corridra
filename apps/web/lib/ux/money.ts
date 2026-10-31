// One money formatter and converter (commercial readiness program, D10). Storage stays in exact
// minor units; people type and read major units. The exponent comes from the controlled ISO 4217
// snapshot in @corridra/domain. Never adds amounts in different currencies. Owner after Wave 0: WS-E.
import { currencies } from '@corridra/domain/currencies';
import { displayMoney, originalAmountToMinor } from '@corridra/domain/locale';

export type CurrencyCode = keyof typeof currencies;

/** Pinned first in every currency picker. */
export const pinnedCurrencies = ['BDT', 'USD', 'EUR', 'CNY', 'GBP'] as const;
/** Fund and testing codes that are never offered for prices. */
export const hiddenCurrencies = [
  'BOV',
  'CHE',
  'CHW',
  'CLF',
  'COU',
  'CUC',
  'USN',
  'UYI',
  'XSU',
  'XUA',
] as const;

export function isCurrency(code: string): code is CurrencyCode {
  return Object.hasOwn(currencies, code);
}

export function currencyExponent(code: string): number {
  if (!isCurrency(code)) throw new Error('Choose a supported currency.');
  return currencies[code];
}

/** "USD 100.00" from minor units ("10000"). Integers or strings only; never a float. */
export function formatMoney(
  minor: string | number | bigint,
  currency: string,
  locale = 'en',
): string {
  const text = typeof minor === 'string' ? minor.trim() : BigInt(minor).toString();
  return displayMoney(text, currency, locale === 'en' ? 'en' : locale).replace(/ /g, ' ');
}

/** Minor units as a string from what a person typed ("100" or "100.5" in USD gives "10050"). */
export function toMinor(major: string, currency: string): string {
  return originalAmountToMinor(major.replace(/,/g, ''), currency);
}

/** The major-unit text for an input value from minor units ("10050" in USD gives "100.50"). */
export function toMajorText(minor: string | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || minor === '') return '';
  if (!/^-?(0|[1-9][0-9]*)$/.test(minor)) return '';
  const places = currencyExponent(currency);
  const negative = minor.startsWith('-');
  const digits = minor.replace(/^-/, '').padStart(places + 1, '0');
  const whole = places ? digits.slice(0, -places) : digits;
  const fraction = places ? `.${digits.slice(-places)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Picker options: pinned codes first, fund codes hidden, labels are names with the code. */
export function currencyOptions(locale = 'en'): { value: string; label: string }[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale === 'en' ? 'en-GB' : locale], { type: 'currency' });
  } catch {
    names = null;
  }
  const label = (code: string) => `${names?.of(code) ?? code} (${code})`;
  const hidden = new Set<string>(hiddenCurrencies);
  const pinned = new Set<string>(pinnedCurrencies);
  const rest = Object.keys(currencies)
    .filter((code) => !hidden.has(code) && !pinned.has(code))
    .map((code) => ({ value: code, label: label(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...pinnedCurrencies.map((code) => ({ value: code, label: label(code) })), ...rest];
}
