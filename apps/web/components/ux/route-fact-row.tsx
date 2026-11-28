'use client';
import { useId, useState, type ReactNode } from 'react';
import type { FieldState } from '@corridra/domain/route-pack-standard';
import { StatusBadge } from '../access-state';
import { CorridraIcon } from '../corridra-icon';
import { FactMark, StaleMark } from './fact-mark';
import { SourceStamp } from './source-stamp';
import './route-fact-row.css';

// One field of a route (ADR-093 Phase 3): its label, the Core word, the value, the state, the source and the stale mark. It
// draws what it is given and holds no rule of its own. It draws no button of its own: `action` is the one slot the editor fills
// with the editing control (PR 2b: Edit, or Undo Change on a row with an unsaved edit). Everything a person reads is words: the shape of the state never stands alone.
export type RouteFactValue =
  { kind: 'empty' } | { kind: 'text'; text: string } | { kind: 'list'; items: string[] };
const longText = 140;
const longList = 3;

export function RouteFactRow({
  label,
  core,
  locked,
  state,
  value,
  note,
  packNote,
  source,
  observed,
  validUntil,
  staleSince,
  action,
  editing,
  editor,
  unsaved,
  heading,
  hidden,
}: {
  label: string;
  core: boolean;
  /** A pack setting: the value is the pack's, with no source or dates. */
  locked: boolean;
  state: FieldState;
  value: RouteFactValue;
  /** The reason a fact is Not applicable. */
  note?: string | null;
  /** A note that stands in place of a value (the sourcing profile). */
  packNote?: string | null;
  /** "Staff knowledge" or the host of an address, as plain words. */
  source?: string | null;
  /** The observed day, already formatted. */
  observed?: string | null;
  /** The valid-until day, already formatted. */
  validUntil?: string | null;
  /** The valid-until day, already formatted, of a fact that has run out. */
  staleSince?: string | null;
  /**
   * The one button of the row (Edit, or Undo Change), drawn once, in the state line right after the state mark: that line always
   * has room for it, so it never takes a line of its own (after a long stale mark or note it could, by a few pixels of font).
   */
  action?: ReactNode;
  /** The row is open for editing: its label and Core chip stay, its value and meta are hidden and `editor` is drawn under it. */
  editing?: boolean;
  editor?: ReactNode;
  /** The row has an edit that is not saved: "Changed, not saved" is said beside its state. */
  unsaved?: boolean;
  /** A heading drawn inside the row, so a folded row hides it too (the first row of a section in a folded list). */
  heading?: ReactNode;
  /** Set by `ShowMoreList` on a row it has folded. */
  hidden?: boolean;
}) {
  const [full, setFull] = useState(false);
  const valueId = useId();
  const long =
    value.kind === 'text'
      ? value.text.length > longText || value.text.includes('\n')
      : value.kind === 'list' && value.items.length > longList;
  return (
    <li className="ux-fact-row" data-state={state} hidden={hidden}>
      {heading}
      <div className="ux-fact-body">
        <div className="ux-fact-main">
          <span className="ux-fact-label" dir="auto">
            {label}
            {core ? <StatusBadge tone="neutral">Core</StatusBadge> : null}
          </span>
          {/* A fact marked Not applicable has no value to wait for: its reason is shown beside its state. */}
          <div
            className="ux-fact-value"
            id={valueId}
            dir="auto"
            hidden={editing === true || (value.kind === 'empty' && state === 'NOT_APPLICABLE')}
          >
            {value.kind === 'empty' ? (
              <p className="ux-fact-quiet">{packNote ?? 'Not filled yet'}</p>
            ) : value.kind === 'text' ? (
              <p className="ux-fact-text" data-full={full ? 'true' : 'false'}>
                {value.text}
              </p>
            ) : (
              <ul className="ux-fact-list" data-full={full ? 'true' : 'false'}>
                {(full ? value.items : value.items.slice(0, longList)).map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            )}
            {long ? (
              <button
                type="button"
                className="text-link ux-fact-toggle"
                aria-expanded={full}
                aria-controls={valueId}
                onClick={() => setFull((current) => !current)}
              >
                {full ? 'Show Less' : 'Show Full Value'}
              </button>
            ) : null}
          </div>
        </div>
        <div className="ux-fact-meta" hidden={editing === true}>
          <div className="ux-fact-state">
            <FactMark state={state} />
            {action ? <span className="ux-fact-action">{action}</span> : null}
            {unsaved ? <span className="ux-fact-unsaved">Changed, not saved</span> : null}
            {note ? <span className="ux-fact-note">Not applicable: {note}</span> : null}
            {staleSince ? <StaleMark>Stale since {staleSince}</StaleMark> : null}
          </div>
          {locked ? (
            <span className="ux-fact-pack">
              <CorridraIcon name="lock" />
              Pack setting
            </span>
          ) : source ? (
            <span className="ux-fact-source">
              <SourceStamp source={source} date={observed ?? undefined} />
              {validUntil ? <span className="ux-fact-until">Valid until {validUntil}</span> : null}
            </span>
          ) : null}
        </div>
      </div>
      {editing && editor ? <div className="ux-fact-editor">{editor}</div> : null}
    </li>
  );
}
