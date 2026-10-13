import { currencies } from './currencies';
import { locale as parseLocale, timeZone } from './geography';

export const interfaceLocales = ['en', 'bn'] as const;
export function displayDate(value: string, zone = 'UTC', language = 'en') {
  timeZone.parse(zone);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Valid date required');
  return `${new Intl.DateTimeFormat(parseLocale.parse(language), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  }).format(date)} (${zone})`;
}
// Never turn an authoritative minor-unit amount into a floating point number.
export function displayMoney(minor: string, code: string, language = 'en') {
  if (!/^-?(0|[1-9][0-9]*)$/.test(minor) || !Object.hasOwn(currencies, code))
    throw new Error('Supported currency and exact minor-unit amount required');
  const places = currencies[code as keyof typeof currencies];
  const negative = minor.startsWith('-');
  const digits = minor.replace(/^-/, '').padStart(places + 1, '0');
  const whole = BigInt(places ? digits.slice(0, -places) : digits);
  const selected = parseLocale.parse(language);
  const numerals = new Intl.NumberFormat(selected, { useGrouping: false });
  const fraction = places
    ? digits.slice(-places).replace(/[0-9]/g, (d) => numerals.format(Number(d)))
    : '';
  return new Intl.NumberFormat(selected, {
    style: 'currency',
    currency: code,
    currencyDisplay: 'code',
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
    .formatToParts(negative ? (whole === BigInt(0) ? -0 : -whole) : whole)
    .map((part) => (part.type === 'fraction' ? fraction : part.value))
    .join('');
}

export function originalAmountToMinor(input: string, code: string) {
  if (!Object.hasOwn(currencies, code)) throw new Error('Choose the original currency.');
  const value = input.trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
    throw new Error(
      'Enter an original nonnegative amount using a period for the decimal separator.',
    );
  const places = currencies[code as keyof typeof currencies],
    [whole, fraction = ''] = value.split('.');
  if (fraction.length > places)
    throw new Error(`${code} permits at most ${places} decimal places. No rounding is performed.`);
  const digits = (whole + fraction.padEnd(places, '0')).replace(/^0+(?=[0-9])/, '');
  if (digits.length > 18) throw new Error('The amount exceeds the supported range.');
  return BigInt(digits).toString();
}
