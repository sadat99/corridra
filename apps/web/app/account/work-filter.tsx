'use client';
import { useRouter } from 'next/navigation';
import { SegmentedFilter, type SegmentOption } from '../../components/ux/segmented-filter';
import type { WorkFilter } from '../../lib/work-items/view';
import { rememberJourneyMode, useJourneyMode } from '../../components/ux/journey-mode-context';

/**
 * The filter of the Requests tab. A choice applies at once: the address changes to ?work= (every other word in
 * the address, such as the chosen tab, is kept) and the page reads the new list. No Show button.
 */
export function WorkFilterBar({
  filter,
  options,
}: {
  filter: WorkFilter;
  options: SegmentOption<WorkFilter>[];
}) {
  const router = useRouter();
  // Journey modes: a chip is the same choice as the sidebar's Journey, so it is written to the same cookie.
  const modes = useJourneyMode() !== null;
  return (
    <SegmentedFilter
      label="Show"
      value={filter}
      options={options}
      onChange={(next) => {
        if (modes) rememberJourneyMode(next === 'other' ? 'all' : next);
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'work');
        if (next === 'all') url.searchParams.delete('work');
        else url.searchParams.set('work', next);
        router.replace(url.pathname + url.search + url.hash, { scroll: false });
      }}
    />
  );
}
