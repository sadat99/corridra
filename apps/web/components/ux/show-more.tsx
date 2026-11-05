'use client';
// A list that shows its first few items and keeps the rest in the page behind "Show all N" (layout
// budget, page length: lists page or load more after a fixed count, content is never removed). The
// hidden items stay in the HTML, so a search, a screen reader's "find" and any entry inside them keep
// working once shown. Works with server-rendered items: pass the <li> elements as children.
// Owner: WS-E (single writer: S4).
import './show-more.css';
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export function ShowMoreList({
  limit,
  noun,
  className,
  children,
}: {
  /** How many items show before the rest fold away. */
  limit: number;
  /** The plural noun in the button: "Show all 11 open gaps". */
  noun: string;
  className?: string;
  children: ReactNode;
}) {
  const items = Children.toArray(children).filter(isValidElement) as ReactElement<{
    hidden?: boolean;
  }>[];
  const [all, setAll] = useState(false);
  const listId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-list`;
  return (
    <>
      <ul id={listId} className={className ? `ux-showmore ${className}` : 'ux-showmore'}>
        {items.map((item, index) =>
          index < limit || all ? item : cloneElement(item, { hidden: true }),
        )}
      </ul>
      {items.length > limit ? (
        <button
          type="button"
          className="text-link ux-showmore-button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll((value) => !value)}
        >
          {all ? `Show the first ${limit} ${noun}` : `Show all ${items.length} ${noun}`}
        </button>
      ) : null}
    </>
  );
}
