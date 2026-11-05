import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import './row-list.css';

/** One cell of a row: its column name (read by assistive technology) and what it shows. */
export type RowCell = { name: string; value: ReactNode; status?: boolean; lang?: string };

/**
 * A list where the whole row is the link (customer experience spec, components). Rows are at least 44 px,
 * show a visible focus ring, and keep to one reading order: title first, then the cells. Status is the one
 * thing shown as a badge. From 64 rem the cells line up in columns under a quiet header; below that each row
 * stacks. `columns` names the cells after the title and may give each a width.
 */
export function RowList({
  label,
  title = 'Name',
  columns = [],
  lang,
  children,
}: {
  label: string;
  /** The language of the column names, where the page around them is in another one. */
  lang?: string;
  /** The heading of the first column. */
  title?: string;
  columns?: { name: string; width?: string }[];
  children: ReactNode;
}) {
  const template = ['minmax(0, 2.4fr)', ...columns.map((c) => c.width ?? 'minmax(0, 1fr)')].join(
    ' ',
  );
  return (
    <div className="ux-rows" lang={lang} style={{ '--ux-row-cols': template } as CSSProperties}>
      {columns.length > 0 ? (
        <div className="ux-rows-head" aria-hidden="true">
          <span>{title}</span>
          {columns.map((c) => (
            <span key={c.name}>{c.name}</span>
          ))}
        </div>
      ) : null}
      <ul aria-label={label}>{children}</ul>
    </div>
  );
}

/**
 * One row. The link's accessible name is its whole visible text (title, then each cell with its column name), so
 * what a person sees is what a voice command or a screen reader uses.
 */
export function RowLink({
  href,
  title,
  titleLang,
  cells = [],
}: {
  href: string;
  title: ReactNode;
  titleLang?: string;
  cells?: RowCell[];
}) {
  return (
    <li className="ux-row">
      <Link prefetch={false} className="ux-row-link" href={href}>
        <span className="ux-row-title" lang={titleLang}>
          {title}
        </span>
        {cells.map((cell) => (
          <span key={cell.name} className="ux-row-cell" lang={cell.lang}>
            <span className="sr-only">{cell.name}: </span>
            <span className="ux-row-value">
              {cell.status ? <span className="ux-badge">{cell.value}</span> : cell.value}
            </span>
          </span>
        ))}
      </Link>
    </li>
  );
}
