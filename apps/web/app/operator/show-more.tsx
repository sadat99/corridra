'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * CRUD G12: the one control for a paged list. It says how many rows are shown of the exact total and
 * offers the next page only when there is one. `label` names the rows, for example "Meetings".
 *
 * Accessibility (G12 follow-up): while a page loads the button stays focusable and says it is busy
 * (aria-disabled, not disabled, which would drop the focus). The count is a polite status, so a screen
 * reader hears "Showing 100 of 120" when the new rows arrive. Focus stays on the button; after the last
 * page the button goes away and focus moves to the count, which then says every row is shown.
 */
export function ShowMore({
  shown,
  total,
  next,
  busy,
  label,
  onMore,
}: {
  shown: number;
  total: number | null | undefined;
  next: string | null | undefined;
  busy: boolean;
  label: string;
  onMore: () => void;
}) {
  const [used, setUsed] = useState(false),
    hadFocus = useRef(false),
    status = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!next && hadFocus.current) {
      hadFocus.current = false;
      status.current?.focus();
    }
  }, [next]);
  // A list that never had a next page needs no control; one that reached its end keeps the count.
  if (!next && !used) return null;
  const noun = label.toLowerCase();
  return (
    <div className="ux-show-more">
      <span role="status" aria-live="polite" tabIndex={-1} ref={status}>
        {next ? `Showing ${shown} of ${total ?? shown} ${noun}.` : `Showing all ${shown} ${noun}.`}
      </span>{' '}
      {next && (
        <button
          className="text-link"
          type="button"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (busy) return;
            setUsed(true);
            hadFocus.current = true;
            onMore();
          }}
        >
          Show More {label}
        </button>
      )}
    </div>
  );
}
