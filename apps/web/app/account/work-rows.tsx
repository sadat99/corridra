'use client';
import { Children, useState, type ReactNode } from 'react';

/** The first rows, then one button for more: a long list stays within the scroll budget. */
export const workRowsFirst = 20;

export function WorkRows({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  const [shown, setShown] = useState(workRowsFirst);
  return (
    <>
      <ul className="work-rows">{rows.slice(0, shown)}</ul>
      {rows.length > shown && (
        <button
          type="button"
          className="work-more"
          onClick={() => setShown((count) => count + workRowsFirst)}
        >
          Show {Math.min(workRowsFirst, rows.length - shown)} more
        </button>
      )}
    </>
  );
}
