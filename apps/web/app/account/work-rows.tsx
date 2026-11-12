'use client';
import { Children, useState, type ReactNode } from 'react';
import { RowList } from '../../components/ux/row-list';

/** The first rows, then one button for more: a long list stays within the scroll budget. */
export const workRowsFirst = 10;

export function WorkRows({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  const [shown, setShown] = useState(workRowsFirst);
  return (
    <>
      <RowList
        label="Your work"
        title="Request"
        columns={[
          { name: 'Journey', width: 'minmax(0, 0.8fr)' },
          { name: 'Kind' },
          { name: 'Workspace' },
          { name: 'Status' },
          { name: 'Date' },
        ]}
      >
        {rows.slice(0, shown)}
      </RowList>
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
