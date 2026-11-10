'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * CRUD G12: the one control for a paged list. It says how many rows are shown of the exact total and
 * offers the next page only when there is one. `label` names the rows, for example "Meetings".
 *
 * Accessibility (G12 follow-up): while a page loads the button stays focusable and says it is busy
 * (aria-disabled, not disabled, which would drop the focus). The count is a polite status, so a screen
 * reader hears "Showing 100 of 120" when the new rows arrive. Focus stays on the button; when a click
 * loads the last page the button goes away and focus moves to this control's own container, never to
 * the status itself, so the new count is announced once.
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
  // The row count when Show More was last clicked. The list counts as paged only while it holds more
  // rows than that, so a refetch back to the first page drops "Showing all" and the control with it.
  const [clickedAt, setClickedAt] = useState<number | null>(null),
    paged = clickedAt !== null && shown > clickedAt,
    // Set by a click, cleared when that click's page has loaded: only that load may move the focus.
    pending = useRef(false),
    wasBusy = useRef(false),
    box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (busy) {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    if (pending.current && !next) box.current?.focus();
    pending.current = false;
  }, [busy, next]);
  if (!next && !paged) return null;
  const noun = label.toLowerCase();
  return (
    <div className="ux-show-more" tabIndex={-1} ref={box}>
      <span role="status" aria-live="polite">
        {next ? `Showing ${shown} of ${total ?? shown} ${noun}.` : `Showing all ${shown} ${noun}.`}
      </span>{' '}
      {next && (
        <button
          className="text-link"
          type="button"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (busy) return;
            setClickedAt(shown);
            pending.current = true;
            onMore();
          }}
        >
          Show More {label}
        </button>
      )}
    </div>
  );
}
