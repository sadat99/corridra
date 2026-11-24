'use client';
// Presentation for the operator desk Today (CORRIDRA_UX_OPERATOR_DESK): the queue as a real table and the two collapsed
// rows. They hold no read and no rule; today.tsx passes in what was loaded. Owner approval: 20 Nov 2026.
import { useId, useState, type ReactNode } from 'react';
import { OperatorIcon } from '../../components/operator-icon';
import { formatDate } from '../../lib/ux/format';
import { deskChip, type DeskRow } from '../../lib/ux/team-today';
import { readFailureCanRetry, partFailureWords, type ReadFailureKind } from './read-failure';

export type DeskRowView = {
  row: DeskRow;
  /** What the row is, as one line. */
  what: string;
  /** The company of a mission, or the queue of an erasure request. */
  group: string;
  href: string;
};

/** The "Late" or "New" chip: an icon and words, so colour is never the only sign. */
export function DeskChip({ row, observedAt }: { row: DeskRow; observedAt: string }) {
  return (
    <span className="ux-desk-chip" data-tone={row.late ? 'late' : 'new'}>
      {row.late ? <OperatorIcon name="clock" /> : null}
      {deskChip(row, observedAt)}
    </span>
  );
}

/** The queue. Rows past `firstRows` are hidden until Show More; nothing is dropped. */
export function DeskTable({
  views,
  observedAt,
  firstRows,
  all,
  tableId,
}: {
  views: DeskRowView[];
  observedAt: string;
  firstRows: number;
  all: boolean;
  tableId: string;
}) {
  return (
    <div className="ux-desk-scroll">
      <table id={tableId} className="ux-desk-table">
        <caption className="sr-only">Things that need you now, latest first</caption>
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col" className="ux-desk-col-mission">
              Mission
            </th>
            <th scope="col">Due</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {views.map(({ row, what, group, href }, index) => (
            <tr key={row.key} hidden={!all && index >= firstRows}>
              <th scope="row" className="ux-desk-what">
                <span>{what}</span>
                <span className="ux-desk-mission-inline">{group}</span>
              </th>
              <td className="ux-desk-col-mission">{group}</td>
              <td className="ux-desk-due">
                <DeskChip row={row} observedAt={observedAt} />
                <time dateTime={row.dueAt}>{formatDate(row.dueAt)}</time>
              </td>
              <td>
                <a
                  className="text-link ux-desk-open"
                  href={href}
                  aria-label={`Open ${what}, ${group}`}
                >
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Team desk v4.1 (CORRIDRA_UX_TEAM_DESK_V41): the rows of one Today region. One table shape serves both regions.
export type RegionRowView = {
  key: string;
  /** The short request reference, only when a read carried it. */
  reference: string | null;
  what: string;
  /** The company of a mission, or what kind of thing the row is. */
  group: string;
  /** The late pill, the stage or nothing. */
  chip: ReactNode;
  /** The date cell: a due date or a meeting time, and a meeting's place. */
  when: ReactNode;
  /** The word before the date on a phone, where the column heading is not shown: "Due" or "Starts". */
  whenWord: string;
  href: string;
};

/**
 * One region's rows. With `primary`, the first row carries the page's one primary button and every later row the
 * quiet link; without it every row is quiet. Rows past `firstRows` stay in the table, hidden until Show More.
 */
export function RegionTable({
  views,
  firstRows,
  all,
  tableId,
  caption,
  whenHeading,
  action,
  primary = false,
}: {
  views: RegionRowView[];
  firstRows: number;
  all: boolean;
  tableId: string;
  caption: string;
  whenHeading: string;
  /** The word on each row's link: "Review" where a decision is due, "Open" where it is not. */
  action: string;
  /** Only the region that needs a decision passes this: one cobalt button on the page. */
  primary?: boolean;
}) {
  return (
    <div className="ux-desk-scroll">
      <table id={tableId} className="ux-desk-table ux-today41-table" role="table">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              What
            </th>
            <th scope="col" role="columnheader" className="ux-desk-col-mission">
              For
            </th>
            <th scope="col" role="columnheader">
              {whenHeading}
            </th>
            <th scope="col" role="columnheader">
              Action
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {views.map(({ key, reference, what, group, chip, when, whenWord, href }, index) => (
            <tr key={key} role="row" hidden={!all && index >= firstRows}>
              <th scope="row" role="rowheader" className="ux-desk-what">
                {reference ? <span className="ux-today41-reference">{reference}</span> : null}
                <span>{what}</span>
                <span className="ux-desk-mission-inline">{group}</span>
              </th>
              <td role="cell" className="ux-desk-col-mission">
                {group}
              </td>
              <td role="cell" className="ux-desk-due">
                {chip}
                <span className="ux-today41-when">
                  <span className="ux-today41-when-word">{whenWord} </span>
                  {when}
                </span>
              </td>
              <td role="cell">
                <a
                  className={
                    primary && index === 0
                      ? 'primary-link ux-today41-review'
                      : 'text-link ux-today41-review'
                  }
                  href={href}
                  aria-label={`${action} ${reference ? `${reference}, ` : ''}${what}, ${group}`}
                >
                  {action}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One collapsed row: a title, a short line, and a Show or Hide button. Closed on every width. */
export function DeskFold({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <section className="ux-desk-fold" aria-labelledby={`${id}-title`}>
      <div className="ux-desk-fold-head">
        <h3 id={`${id}-title`}>{title}</h3>
        {summary ? <span className="ux-desk-fold-summary">{summary}</span> : null}
        <button
          type="button"
          id={`${id}-button`}
          className="text-link ux-desk-toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          aria-labelledby={`${id}-button ${id}-title`}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      <div id={`${id}-body`} className="ux-desk-fold-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** One part that could not be read while the rest of the page worked. */
export function PartFailure({
  part,
  kind,
  onRetry,
}: {
  part: string;
  kind: ReadFailureKind;
  onRetry: () => void;
}) {
  return (
    <div role="status" className="ux-desk-part-failure">
      <p>{partFailureWords(part, kind)}</p>
      {readFailureCanRetry(kind) && (
        <button type="button" className="text-link" onClick={onRetry}>
          Try Again
        </button>
      )}
    </div>
  );
}
