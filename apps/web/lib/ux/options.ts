// Picker options for countries and time zones (commercial readiness program, D9 and 5.2). Labels are
// names, never codes. Owner after Wave 0: WS-E.
import { countryCodes } from '@corridra/domain/countries';
import { timeZoneLabel } from './format';

export type PickerOption = { value: string; label: string; hint?: string };

/**
 * Bangladesh, China, the UK, the US and Australia first (owner decision 17 November 2026, routes and markets); the EU is
 * pinned by the market picker and its member states follow as a group. Spain stays searchable. Display order only: the
 * request body carries the chosen codes unchanged.
 */
export const pinnedCountries = ['BD', 'CN', 'GB', 'US', 'AU'] as const;

/** The markets open now from Bangladesh, by request code (owner decision 17 November 2026). The EU member states count with the EU. */
export const openMarketCodes = ['CN', 'EU', 'GB', 'US', 'AU'] as const;
export const euCountries = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'SE',
] as const;
export const pinnedTimeZones = ['Asia/Dhaka', 'Europe/Madrid', 'Asia/Shanghai', 'UTC'] as const;

function displayNames(locale: string, type: 'region') {
  try {
    return new Intl.DisplayNames([locale === 'en' ? 'en-GB' : locale], { type });
  } catch {
    return null;
  }
}

export function countryName(code: string, locale = 'en'): string {
  try {
    return displayNames(locale, 'region')?.of(code) ?? code;
  } catch {
    // A value that is not a region code ("OTHER") makes `of` throw a RangeError: show it as it is stored.
    return code;
  }
}

/** Pinned countries, then the other EU countries, then every other country by name. */
export function countryOptions(locale = 'en'): PickerOption[] {
  const option = (value: string) => ({ value, label: countryName(value, locale) });
  const pinned = new Set<string>(pinnedCountries);
  const eu = euCountries
    .filter((c) => !pinned.has(c))
    .map((c) => ({ ...option(c), hint: 'EU' }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const euSet = new Set<string>(euCountries);
  const rest = countryCodes
    .filter((c) => !pinned.has(c) && !euSet.has(c))
    .map(option)
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...pinnedCountries.map(option), ...eu, ...rest];
}

function supportedZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    return intl.supportedValuesOf?.('timeZone') ?? [...pinnedTimeZones];
  } catch {
    return [...pinnedTimeZones];
  }
}

/** Pinned zones first, then every zone, each labelled "Dhaka, UTC+6" with the region as a hint. */
export function timeZoneOptions(at: Date = new Date()): PickerOption[] {
  const option = (zone: string) => ({
    value: zone,
    label: timeZoneLabel(zone, at),
    hint: zone.includes('/') ? zone.split('/')[0]!.replaceAll('_', ' ') : undefined,
  });
  const pinned = new Set<string>(pinnedTimeZones);
  const rest = supportedZones()
    .filter((zone) => !pinned.has(zone))
    .map(option)
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...pinnedTimeZones.map(option), ...rest];
}
