'use client';
// Replaces every raw reference text field (D9). Searches GET /api/picker/<kind>?tenant=&q= and shows
// names, never ids. Owner after Wave 0: WS-E (UI); WS-D owns the search API.
import { useEffect, useRef, useState } from 'react';
import type { PickerOption } from '../../lib/ux/options';
import type { PickerKind } from '../../lib/ux/picker';
import { SearchSelect, type SearchSelectProps } from './search-select';

const kindLabel: Record<PickerKind, string> = {
  contributor: 'Contributor',
  source: 'Source',
  mission: 'Mission',
  route: 'Route',
  reviewer: 'Reviewer',
  publication: 'Report',
};

export function ReferencePicker({
  kind,
  tenant,
  label,
  value,
  onChange,
  initialOptions = [],
  ...rest
}: Omit<SearchSelectProps, 'options' | 'label' | 'onQuery'> & {
  kind: PickerKind;
  tenant: string;
  label?: string;
  initialOptions?: PickerOption[];
}) {
  const [options, setOptions] = useState<PickerOption[]>(initialOptions);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const call = ++latest.current;
    const timer = window.setTimeout(() => {
      fetch(
        `/api/picker/${kind}?tenant=${encodeURIComponent(tenant)}&q=${encodeURIComponent(query)}`,
      )
        .then(async (r) => {
          if (!r.ok) throw new Error('search failed');
          const body = (await r.json()) as { options: PickerOption[] };
          if (call !== latest.current) return;
          setFailed(false);
          // Keep the chosen option visible even when a new search does not return it.
          setOptions((current) => {
            const chosen = current.find((o) => o.value === value);
            const next = body.options;
            return chosen && !next.some((o) => o.value === chosen.value) ? [chosen, ...next] : next;
          });
        })
        .catch(() => {
          if (call === latest.current) setFailed(true);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [kind, tenant, query, value]);
  return (
    <SearchSelect
      {...rest}
      label={label ?? kindLabel[kind]}
      options={options}
      value={value}
      onChange={onChange}
      onQuery={setQuery}
      error={rest.error ?? (failed ? 'Search is not available right now. Try again.' : undefined)}
      emptyText={query ? 'No matches. Try another word.' : 'Start typing to search.'}
    />
  );
}
