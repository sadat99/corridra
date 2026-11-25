'use client';
// Replaces every raw reference text field (D9). Searches GET /api/picker/<kind>?tenant=&q= and shows
// names, never ids. Owner after Wave 0: WS-E (UI); WS-D owns the search API.
import { useEffect, useRef, useState } from 'react';
import type { PickerOption } from '../../lib/ux/options';
import type { PickerKind } from '../../lib/ux/picker';
import { ReverifyLine } from './reverify-line';
import { SearchSelect, type SearchSelectProps } from './search-select';
import { refusedForCheck } from './step-up-reads';

const kindLabel: Record<PickerKind, string> = {
  contributor: 'Contributor',
  source: 'Source',
  mission: 'Mission',
  route: 'Route',
  reviewer: 'Reviewer',
  publication: 'Report',
};

// The plural noun for the quiet line, said outright: a label ("Request owner") never becomes "request owners" by
// adding a letter.
const kindPlural: Record<PickerKind, string> = {
  contributor: 'contributors',
  source: 'sources',
  mission: 'missions',
  route: 'routes',
  reviewer: 'reviewers',
  publication: 'reports',
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
  // The list needs a fresh authenticator check: one quiet line with the in-place check, and no search until it passes.
  const [needsCheck, setNeedsCheck] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    if (needsCheck) return;
    const call = ++latest.current;
    const timer = window.setTimeout(() => {
      fetch(
        `/api/picker/${kind}?tenant=${encodeURIComponent(tenant)}&q=${encodeURIComponent(query)}`,
      )
        .then(async (r) => {
          if (!r.ok) {
            if (await refusedForCheck(r)) {
              if (call === latest.current) setNeedsCheck(true);
              return;
            }
            throw new Error('search failed');
          }
          const body = (await r.json().catch(() => null)) as { options?: unknown } | null;
          if (call !== latest.current) return;
          // A response without a list of options is a failed search, never an empty crash.
          if (!body || !Array.isArray(body.options)) throw new Error('search failed');
          const found = body.options.filter(
            (o): o is PickerOption =>
              !!o &&
              typeof (o as PickerOption).value === 'string' &&
              typeof (o as PickerOption).label === 'string',
          );
          setFailed(false);
          // Keep the chosen option visible even when a new search does not return it.
          setOptions((current) => {
            const chosen = current.find((o) => o.value === value);
            const next = found;
            return chosen && !next.some((o) => o.value === chosen.value) ? [chosen, ...next] : next;
          });
        })
        .catch(() => {
          if (call === latest.current) setFailed(true);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [kind, tenant, query, value, needsCheck]);
  const field = (
    <SearchSelect
      {...rest}
      label={label ?? kindLabel[kind]}
      options={options}
      value={value}
      onChange={onChange}
      onQuery={setQuery}
      disabled={needsCheck || rest.disabled}
      error={rest.error ?? (failed ? 'Search is not available right now. Try again.' : undefined)}
      emptyText={query ? 'No matches. Try another word.' : 'Start typing to search.'}
    />
  );
  // While the check is waiting the field stays in the form, disabled, with its hidden input, so a chosen value is not
  // dropped from what the form posts; the one quiet line sits beside it.
  if (needsCheck)
    return (
      <>
        {field}
        <ReverifyLine
          what={`the list of ${kindPlural[kind]}`}
          onVerified={() => setNeedsCheck(false)}
        />
      </>
    );
  return field;
}
