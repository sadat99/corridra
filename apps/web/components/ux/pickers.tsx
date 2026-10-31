'use client';
// Country, currency and time zone pickers (commercial readiness program, D9, D10 and 5.2).
// Owner after Wave 0: WS-E (internals only; props are fixed).
import { useMemo } from 'react';
import { currencyOptions, pinnedCurrencies } from '../../lib/ux/money';
import {
  countryOptions,
  pinnedCountries,
  pinnedTimeZones,
  timeZoneOptions,
} from '../../lib/ux/options';
import { SearchSelect, type SearchSelectProps } from './search-select';

type Wrapped = Omit<SearchSelectProps, 'options' | 'pinned' | 'label'> & {
  label?: string;
  locale?: string;
};

export function CountrySelect({ label = 'Country', locale = 'en', ...props }: Wrapped) {
  const options = useMemo(() => countryOptions(locale), [locale]);
  return <SearchSelect {...props} label={label} options={options} pinned={pinnedCountries} />;
}

export function CurrencySelect({ label = 'Currency', locale = 'en', ...props }: Wrapped) {
  const options = useMemo(() => currencyOptions(locale), [locale]);
  return <SearchSelect {...props} label={label} options={options} pinned={pinnedCurrencies} />;
}

export function TimeZoneSelect({ label = 'Time zone', ...props }: Wrapped) {
  const options = useMemo(() => timeZoneOptions(), []);
  return <SearchSelect {...props} label={label} options={options} pinned={pinnedTimeZones} />;
}
