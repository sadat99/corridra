'use client';
import { useEffect, useRef, useState } from 'react';
import { SearchSelect } from '../../../components/ux/search-select';
import type { PickerOption } from '../../../lib/ux/options';

/** Company search over the existing research catalogue. Names only, never ids. */
export function OrganisationPicker({
  tenant,
  label,
  hint,
  value,
  onChange,
}: {
  tenant: string;
  label: string;
  hint?: string;
  value: string | null;
  onChange: (value: string | null, name: string) => void;
}) {
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    const call = ++latest.current;
    const timer = window.setTimeout(() => {
      fetch(`/api/workspace/research?${new URLSearchParams({ tenant, q: query.slice(0, 100) })}`, {
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('search failed');
          const body = (await response.json()) as {
            organisations: { id: string; name: string; country: string }[];
          };
          if (call !== latest.current) return;
          setFailed(false);
          setOptions((current) => {
            const chosen = current.find((option) => option.value === value);
            const next = body.organisations.map((o) => ({
              value: o.id,
              label: o.name,
              hint: o.country,
            }));
            return chosen && !next.some((option) => option.value === chosen.value)
              ? [chosen, ...next]
              : next;
          });
        })
        .catch(() => {
          if (call === latest.current) setFailed(true);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [tenant, query, value]);
  return (
    <SearchSelect
      label={label}
      hint={hint}
      options={options}
      value={value}
      onChange={(next) =>
        onChange(next, options.find((option) => option.value === next)?.label ?? '')
      }
      onQuery={setQuery}
      error={failed ? 'Company search is not available right now. Try again.' : undefined}
      emptyText={query ? 'No matches. Try another word.' : 'Start typing to search.'}
    />
  );
}
